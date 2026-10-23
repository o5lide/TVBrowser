#!/usr/bin/env python3
"""Teste de fumaça: abre o Firefox sem janela, carrega a extensão e tira prints de cada etapa.

Dirige o Firefox pelo Marionette (automação embutida) num perfil descartável. As teclas são
eventos de verdade; o controle é simulado trocando navigator.getGamepads na tela inicial (nos
sites isso não alcança a extensão, então lá só o teclado é testado). Os prints ficam em
tests/out/ para conferir no olho.

    python tests/smoke.py            # tudo
    python tests/smoke.py home wiki  # só essas etapas
"""
import base64
import functools
import http.server
import json
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import tvbrowser  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"
KEY = {"up": "", "down": "", "left": "", "right": "", "enter": "", "esc": "", "f1": ""}
PAD = {"a": 0, "b": 1, "x": 2, "y": 3, "rb": 5, "start": 9, "up": 12, "down": 13, "left": 14, "right": 15}

PAD_SCRIPT = """
const [buttons, generic] = arguments;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
return (async () => {
  if (!window.fakePad || window.fakePad.generic !== generic) {
    // generic: exatamente o que o Firefox do Windows mostrou para o celular com BridgePad:
    // sem mapeamento padrão, 16 botões, gatilhos soltos em -1 e o direcional no eixo 9 (solto = 1,29)
    const buttons = Array.from({ length: generic ? 16 : 17 }, () => ({ pressed: false, value: 0 }));
    window.fakePad = generic
      ? { generic, index: 0, connected: true, id: '0075-0100-BridgePad', mapping: '', axes: [0, 0, -1, 0, 0, -1, 0, 0, 0, 9 / 7], buttons }
      : { generic, index: 0, connected: true, id: 'teste', mapping: 'standard', axes: [0, 0, 0, 0], buttons };
    navigator.getGamepads = () => [window.fakePad];
  }
  const pad = window.fakePad;
  for (const button of buttons) {
    // [x, y] = leva o ponteiro até lá com o analógico esquerdo, corrigindo o rumo a cada quadro.
    if (Array.isArray(button)) {
      for (let i = 0; i < 600; i++) {
        const at = window.TV.cursor.point();
        const dx = button[0] - at.x, dy = button[1] - at.y, far = Math.hypot(dx, dy);
        if (window.TV.cursor.active() && far < 5) break;
        const tilt = Math.min(1, Math.max(0.4, far / 250));
        pad.axes[0] = (dx / far) * tilt;
        pad.axes[1] = (dy / far) * tilt;
        await sleep(16);
      }
      pad.axes[0] = pad.axes[1] = 0;
      await sleep(120);
      continue;
    }
    // Textos: "chord:8,9" aperta os dois juntos; "hold:1:1100" segura o botão 1 por 1,1 s;
    // "down:0" / "up:0" apertam e soltam sem esperar (pra fotografar apertado); "axis:0:0.8" move um eixo.
    if (typeof button === 'string' && !button.startsWith('hat:')) {
      const [kind, ...rest] = button.split(':');
      const set = (index, on) => { pad.buttons[index] = { pressed: on, value: on ? 1 : 0 }; };
      if (kind === 'down') set(Number(rest[0]), true);
      else if (kind === 'up') set(Number(rest[0]), false);
      else if (kind === 'axis') pad.axes[Number(rest[0])] = Number(rest[1]);
      else {
        const indexes = rest[0].split(',').map(Number);
        indexes.forEach((index) => set(index, true));
        await sleep(kind === 'hold' ? Number(rest[1]) : 200);
        indexes.forEach((index) => set(index, false));
      }
      await sleep(250);
      continue;
    }
    // "hat:N" = direcional no passo N (0 cima, 2 direita, 4 baixo, 6 esquerda); número = botão.
    // Segura por tempo de sobra pra um quadro lento não perder o aperto (e menos que o início da repetição).
    const hat = typeof button === 'string' ? Number(button.slice(4)) : null;
    if (hat === null) pad.buttons[button] = { pressed: true, value: 1 };
    else pad.axes[9] = -1 + (2 * hat) / 7;
    await sleep(200);
    if (hat === null) pad.buttons[button] = { pressed: false, value: 0 };
    else pad.axes[9] = 9 / 7;
    await sleep(250);
  }
})();
"""


SNAPSHOT_SCRIPT = """
return (async () => {
  const tab = gBrowser.selectedBrowser;
  const area = new DOMRect(0, 0, tab.clientWidth, tab.clientHeight);
  const bitmap = await tab.browsingContext.currentWindowGlobal.drawSnapshot(area, 1, 'rgb(0,0,0)');
  const canvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.toDataURL('image/png').split(',')[1];
})();
"""


class Marionette:
    def __init__(self, port, process):
        self.sock = tvbrowser.connect(port, process)
        self.buffer = b""
        self.count = 0
        self._receive()  # saudação

    def _receive(self):
        while b":" not in self.buffer:
            self.buffer += self.sock.recv(65536)
        size, _, self.buffer = self.buffer.partition(b":")
        size = int(size)
        while len(self.buffer) < size:
            self.buffer += self.sock.recv(1 << 20)
        packet, self.buffer = self.buffer[:size], self.buffer[size:]
        return json.loads(packet)

    def send(self, name, **params):
        self.count += 1
        data = json.dumps([0, self.count, name, params]).encode()
        self.sock.sendall(str(len(data)).encode() + b":" + data)
        _, _, error, result = self._receive()
        if error:
            raise RuntimeError(f"{name}: {error.get('error')}: {error.get('message')}")
        return result.get("value") if isinstance(result, dict) and "value" in result else result

    def keys(self, *names):
        actions = []
        for name in names:
            actions += [{"type": "keyDown", "value": KEY[name]}, {"type": "keyUp", "value": KEY[name]}, {"type": "pause", "duration": 120}]
        self.send("WebDriver:PerformActions", actions=[{"type": "key", "id": "teclado", "actions": actions}])
        time.sleep(0.5)

    def pad(self, *names, generic=False):
        """Aperta botões do controle simulado, por nome (layout padrão) ou por índice cru."""
        buttons = [PAD.get(n, n) if isinstance(n, str) else n for n in names]
        # sandbox=None: roda no próprio escopo da página, onde a tela inicial lê navigator.getGamepads
        self.send("WebDriver:ExecuteScript", script=PAD_SCRIPT, args=[buttons, generic], sandbox=None)
        time.sleep(0.4)

    def steer(self, selector):
        """Leva o ponteiro (analógico esquerdo) até o meio do elemento."""
        x, y = self.script(f"const r = document.querySelector({json.dumps(selector)}).getBoundingClientRect();"
                           "return [r.left + r.width / 2, r.top + r.height / 2]")
        self.pad([x, y])

    def script(self, code):
        return self.send("WebDriver:ExecuteScript", script=code, args=[])

    def page(self, code):
        """Roda no escopo da própria página (enxerga o TV da tela inicial)."""
        return self.send("WebDriver:ExecuteScript", script=code, args=[], sandbox=None)

    def shot(self, name):
        OUT.mkdir(exist_ok=True)
        try:
            png = self.send("WebDriver:TakeScreenshot", full=False)
        except RuntimeError:
            # Página de extensão não aceita o print normal: tira o retrato da aba pelo lado do navegador.
            self.send("Marionette:SetContext", value="chrome")
            try:
                png = self.send("WebDriver:ExecuteScript", script=SNAPSHOT_SCRIPT, args=[])
            finally:
                self.send("Marionette:SetContext", value="content")
        (OUT / f"{name}.png").write_bytes(base64.b64decode(png))
        print(f"  print: tests/out/{name}.png")

    def go(self, url, wait=4):
        self.send("WebDriver:Navigate", url=url)
        time.sleep(wait)


def step_home(m):
    print("url inicial:", m.send("WebDriver:GetCurrentURL"))
    # roda inicial: Netflix, Prime Video, HBO Max, Disney+, Globoplay, YouTube, Twitch, Adicionar, Sair
    selected = "return document.querySelector('.item.sel').dataset.name"
    m.shot("1-home")
    m.keys("down", "down")
    print("teclado, 2x baixo:", m.script(selected))            # HBO Max
    m.shot("2-home-teclado")
    m.pad("down")
    print("controle, baixo:", m.script(selected))              # Disney+
    m.pad("up", "up", "up", "up", "up")
    print("controle, 5x cima (dá a volta):", m.script(selected))  # Adicionar
    # controle genérico (BridgePad): direcional no eixo 9, Start no botão 6
    m.pad("hat:4", "hat:4", generic=True)
    print("genérico, 2x direcional p/ baixo:", m.script(selected))  # Netflix
    m.pad("hat:0", "hat:0", "hat:1", "hat:2", generic=True)
    print("genérico, 2x cima + diagonal + direita:", m.script(selected))  # Adicionar
    m.pad(6, generic=True)
    m.shot("3-menu")
    m.pad("down", "b")

    # Start e Select juntos são o picture-in-picture: não podem abrir o menu nem ir pro início
    m.pad("chord:8,9")
    print("Start + Select juntos abriu o menu?", m.page("return window.TV.menu.isOpen()"))  # False
    m.pad("start")
    print("Start sozinho abriu o menu?", m.page("return window.TV.menu.isOpen()"))  # True

    # Controles: guia, teste (botões acendem, segurar B volta) e troca de símbolos
    m.pad("down", "down", "down", "down", "down", "a")
    print("tela Controles aberta?", m.page("return window.TV.controls.isOpen()"))
    m.shot("3b-controles-guia")
    m.pad("rb")
    m.pad("down:0", "down:7", "down:12", "axis:0:0.8", "axis:1:-0.6")
    m.shot("3c-controles-teste")
    m.pad("up:0", "up:7", "up:12", "axis:0:0", "axis:1:0")
    m.pad("b")
    m.pad("hold:1:1200")
    m.pad("a", "a")  # Automático -> Xbox -> PlayStation
    m.shot("3d-controles-playstation")
    m.pad("a", "b")  # volta pro Automático e fecha
    print("tela Controles fechou?", not m.page("return window.TV.controls.isOpen()"))

    # Janela flutuante: o direcional muda a posição, LB/RB o tamanho, e a escolha fica guardada
    m.pad("start")
    m.pad("down", "down", "down", "down", "down", "down", "a")
    m.pad("left", "up", "rb")
    m.shot("3e-janela-flutuante")
    print("janela flutuante guardada:", m.page("return browser.storage.local.get('floating').then((s) => JSON.stringify(s.floating))"))  # col 1, row 1, 0.4
    m.pad("b")

    # sons: cada um tem que tocar sem erro, com o áudio rodando ("boot" já tocou quando a tela abriu)
    sounds = m.send("WebDriver:ExecuteScript", sandbox=None, args=[], script="""
      const names = ['move', 'wheel', 'key', 'select', 'back', 'open', 'close', 'deny', 'boot', 'não existe'];
      return Promise.all(names.map((name) => browser.runtime.sendMessage({ type: 'sound', name }).then((state) => `${name}=${state}`, (error) => `${name}=ERRO ${error}`)));
    """)
    print("sons:", ", ".join(sounds))

    # ponteiro (analógico esquerdo): A num item fora do meio traz ele pro meio
    m.steer(".item[data-name='Netflix'] .bar")
    m.shot("4-ponteiro")
    m.pad("a")
    print("ponteiro, A em cima de Netflix:", m.script(selected))  # Netflix

    # catálogo: Y abre, direcional anda nos cartões, A adiciona
    m.pad("y")
    time.sleep(3)  # ícones chegando
    m.shot("5-catalogo")
    m.pad("right", "a")
    print("catálogo, 2º cartão adicionado:", m.script(selected), "| sites:", m.script("return document.querySelectorAll('a.item').length"))

    # "Outro site": ponteiro no cartão, depois no campo (abre o teclado virtual), direcional digita
    m.pad("y")
    m.steer(".card:last-child")
    m.pad("a")
    m.steer("#add-url")
    m.pad("a")
    m.pad("right", "a", "down", "a")
    m.shot("6-teclado-virtual")
    print("campo:", repr(m.script("return document.getElementById('add-url').value")))  # yh
    m.pad("start")
    print("endereço digitado adicionado:", m.script(selected))  # yh
    m.pad("x", "x")
    print("X duas vezes remove:", m.script(selected), "| sites:", m.script("return document.querySelectorAll('a.item').length"))

    # ponteiro num botão escondido em shadow root fechada (como os do player da Disney+)
    m.script("""
      const host = document.createElement('div');
      host.id = 'casca';
      host.style.cssText = 'position:fixed;left:40px;top:300px;z-index:99';
      const button = document.createElement('button');
      button.textContent = 'escondido';
      button.style.cssText = 'padding:20px 40px';
      button.addEventListener('click', () => { document.title = 'clicou no escondido'; });
      host.attachShadow({ mode: 'closed' }).append(button);
      document.body.append(host);
    """)
    m.steer("#casca")
    m.pad("a")
    print("ponteiro, botão em shadow fechada:", m.script("return document.title"))
    m.script("document.getElementById('casca').remove()")

    # clique fabricado num link de verdade: o item do meio abre o site
    time.sleep(2)
    m.shot("7-icones")
    m.pad("up", "up")
    name = m.script(selected)
    m.steer(".item.sel .bar")
    try:
        m.pad("a")
    except RuntimeError:
        pass  # a página saiu de baixo do script: é o site abrindo
    time.sleep(3)
    print(f"ponteiro, A no item do meio ({name}):", m.send("WebDriver:GetCurrentURL"))


def step_wiki(m):
    m.go("https://pt.wikipedia.org/wiki/Televis%C3%A3o")
    m.keys("down", "down", "down", "right")
    m.shot("8-wiki")
    m.keys("f1")
    m.shot("9-wiki-menu")
    m.keys("esc")


def step_shadow(m):
    """Direcional em página comum: o foco tem que entrar nos botões dentro de shadow DOM."""
    # servida por http: a extensão não entra em página file://
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    handler = functools.partial(Quiet, directory=str(Path(__file__).resolve().parent))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        m.go(f"http://127.0.0.1:{server.server_port}/shadow.html", wait=2)
        for _ in range(3):
            m.keys("down", "enter")
            print("seta + Enter:", m.script("return document.title"))  # fora, aberta, fechada
        m.shot("12-shadow")
    finally:
        server.shutdown()


def step_youtube(m):
    m.go("https://www.youtube.com/tv", wait=10)
    print("url:", m.send("WebDriver:GetCurrentURL"))
    print("userAgent visto pela página:", m.script("return navigator.userAgent"))
    m.shot("10-youtube-tv")
    m.keys("down", "right")
    m.shot("11-youtube-tv-setas")


STEPS = {"home": step_home, "wiki": step_wiki, "shadow": step_shadow, "youtube": step_youtube}


def main():
    wanted = sys.argv[1:] or list(STEPS)
    port = tvbrowser.free_port()
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        profile = Path(tmp)
        tvbrowser.write_prefs(profile)
        with open(profile / "user.js", "a", encoding="utf-8") as prefs:
            prefs.write(f'user_pref("marionette.port", {port});\nuser_pref("dom.gamepad.test.enabled", true);\n')
        command = tvbrowser.find_firefox(profile) + [
            "-no-remote", "-profile", str(profile), "-marionette", "-remote-allow-system-access", "-headless",
            "--width", "1280", "--height", "720", "about:blank",
        ]
        if sys.platform == "win32":
            command.insert(-1, "-wait-for-browser")
        process = subprocess.Popen(command)
        try:
            m = Marionette(port, process)
            m.send("WebDriver:NewSession")
            print("extensão:", m.send("Addon:Install", path=str(tvbrowser.EXTENSION), temporary=True))
            time.sleep(2.5)
            for name in wanted:
                print(f"[{name}]")
                STEPS[name](m)
            m.send("Marionette:Quit", flags=["eForceQuit"])
            process.wait(timeout=20)
        finally:
            if process.poll() is None:
                tvbrowser.kill(process)


if __name__ == "__main__":
    main()
