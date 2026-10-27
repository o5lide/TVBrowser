"""Janelas do TV Browser comandadas pelo controle: o picture-in-picture (Start + Select) e a troca
entre o TV Browser e o Steam.

A extensão não tem como abrir o picture-in-picture do Firefox sozinha (a página exige um clique de
verdade), então ela só pede: a página de fundo dela guarda o pedido, e este lançador, pendurado
nela pela porta de depuração, executa dentro do próprio navegador, onde isso é permitido.

No Windows, com o picture-in-picture aberto o TV Browser se minimiza e o Steam vem pra frente; o
mesmo Start + Select traz o TV Browser de volta (aí lido direto do controle, pelo vigia do steam.py).
Trocar a janela da frente é o próprio Firefox que faz, chamando o Windows (js-ctypes): quem está na
frente pode passar a vez, e um programa em segundo plano, como este lançador, o Windows barra.
"""
import json
import os
import threading
import time

import tvbrowser


def blocked():
    """Por que o picture-in-picture não funciona aqui, ou None.

    No Modo Jogo do Steam (gamescope) aparece uma janela por vez, em tela cheia: a janelinha abria,
    mas ficava atrás do TV Browser (visto no Bazzite).
    """
    if os.environ.get("GAMESCOPE_WAYLAND_DISPLAY"):
        return "A janela flutuante não funciona no Modo Jogo do Steam"
    return None

# Tudo abaixo roda no navegador, com `args` vindo do Python. "Toolkit:PictureInPicture" é o tipo da
# janelinha do vídeo; handle() dá o identificador da janela no Windows, como texto ("0x6031e").
PRELUDE = """
const main = Services.wm.getMostRecentWindow("navigator:browser");
const pips = [...Services.wm.getEnumerator("Toolkit:PictureInPicture")];
const handle = (win) => win.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).nativeHandle;
"""

WIN32 = """
const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
const user32 = ctypes.open("user32.dll");
const api = (name, result, ...types) => user32.declare(name, ctypes.winapi_abi, result, ...types);
const pointer = (value) => ctypes.voidptr_t(ctypes.UInt64(value));
const inFront = () => parseInt(ctypes.cast(api("GetForegroundWindow", ctypes.voidptr_t)(), ctypes.uintptr_t).value.toString(), 10);
const toFront = (value) => {
  if (api("IsIconic", ctypes.bool, ctypes.voidptr_t)(pointer(value))) api("ShowWindow", ctypes.bool, ctypes.voidptr_t, ctypes.int)(pointer(value), 9);
  api("SetForegroundWindow", ctypes.bool, ctypes.voidptr_t)(pointer(value));
};
"""

# `front`: uma janela nossa (a principal ou a janelinha) é a que está na frente da tela?
STATE = """
let front = null;
if (args.windows) {""" + WIN32 + """
  const now = inFront();
  front = [main, ...pips].some((win) => parseInt(handle(win), 16) === now);
  user32.close();
}
return JSON.stringify({ floating: pips.length, minimized: main.windowState === main.STATE_MINIMIZED, front, handle: handle(main) });
"""

# O mesmo pedido que o atalho de teclado do Firefox faz: a página escolhe o vídeo principal.
OPEN = """
const top = main.gBrowser.selectedBrowser.browsingContext;
const focused = Services.focus.focusedContentBrowsingContext;
const where = focused && focused.top === top ? focused : top;
where.currentWindowGlobal.getActor("PictureInPictureLauncher").sendAsyncMessage("PictureInPicture:KeyToggle");
"""

# Põe a janelinha no lugar e no tamanho pedidos (fração da largura da tela; coluna e linha de 0 a 2).
# Com `away` (Windows): a janelinha deixa de aceitar foco, o Steam (se `steam` vier) passa pra
# frente e o TV Browser se minimiza. Nessa ordem: minimizar a janela que está na frente faria o
# Windows escolher sozinho quem assume, e ele escolhia a janelinha, deixando o controle sem dono.
ARRANGE = """
const [floating] = pips;
if (!floating) return false;
const area = floating.screen;
const width = Math.round(area.availWidth * args.width), height = Math.round(width * floating.outerHeight / floating.outerWidth);
const along = (index, start, room, size) => Math.round(start + [room * 0.03, (room - size) / 2, room - size - room * 0.03][index]);
floating.resizeTo(width, height);
floating.moveTo(along(args.col, area.availLeft, area.availWidth, width), along(args.row, area.availTop, area.availHeight, height));
if (!args.away) {
  main.focus();  // a janelinha nasce com o foco; sem devolver, a página para de ouvir o controle
  return true;
}""" + WIN32 + """
const EX_STYLE = -20, NO_ACTIVATE = 0x08000000;
const style = api("GetWindowLongPtrW", ctypes.intptr_t, ctypes.voidptr_t, ctypes.int)(pointer(handle(floating)), EX_STYLE);
api("SetWindowLongPtrW", ctypes.intptr_t, ctypes.voidptr_t, ctypes.int, ctypes.intptr_t)(pointer(handle(floating)), EX_STYLE, Number(style.toString()) | NO_ACTIVATE);
if (args.steam) toFront(args.steam);
main.minimize();
user32.close();
return true;
"""

# Fora do Windows a janelinha continua aceitando foco, e no KDE ela o pega um instante depois de
# aparecer: a página deixava de ouvir o controle e o vídeo não pausava mais (visto no Bazzite).
KEEP_FOCUS = """
if (pips.includes(Services.focus.activeWindow)) {
  main.focus();
  main.gBrowser.selectedBrowser.focus();
}
return Services.focus.activeWindow === main;
"""

# Passa a frente da tela para outra janela (o Steam). Devolve se ela ficou mesmo na frente.
HAND_OVER = WIN32 + """
toFront(args.target);
const done = inFront() === args.target;
user32.close();
return done;
"""

# Foco na página. O Firefox abre com a aba em branco e o foco na barra de endereço (escondida no
# quiosque): a página ficava sem foco, o Firefox não entregava o controle pra ela e o TV Browser só
# respondia depois de um clique de mouse (visto no Bazzite).
FOCUS_PAGE = """
main.gBrowser.selectedBrowser.focus();
return main.gBrowser.selectedBrowser.currentURI.spec;
"""

# Fecha a janelinha (o vídeo volta pra página), desfaz o minimizar e devolve o foco à página.
RESTORE = """
for (const floating of pips) floating.close();
main.restore();
main.focus();
main.gBrowser.selectedBrowser.focus();
return handle(main);
"""


def script(body, **args):
    return "((args) => {" + PRELUDE + body + "})(" + json.dumps(args) + ")"


class Pip:
    def __init__(self, port, process, windows):
        """`windows`: mexer nas janelas do Windows (minimizar, passar a frente ao Steam e voltar)."""
        self.port, self.process, self.windows = port, process, windows
        self.lock = threading.Lock()  # os pedidos da extensão e os do controle chegam por threads diferentes
        self.quiet_until = 0  # um aperto só chega pelos dois caminhos: depois de agir, ignora o eco
        self.rdp = self.console = None

    def run(self, body, **args):
        if not self.rdp:
            self.rdp, self.console = tvbrowser.open_console(self.port, self.process, "chrome")
        return self.rdp.evaluate(self.console, script(body, **args))

    def state(self):
        return json.loads(self.run(STATE, windows=self.windows))

    def toggle(self, place):
        """Pedido da extensão: o TV Browser está na frente e alguém apertou Start + Select.

        `place`: {"col", "row", "width"} escolhidos na tela Janela flutuante.
        """
        with self.lock:
            if time.monotonic() < self.quiet_until:
                return
            try:
                if self.state()["floating"]:
                    return self.show()
                self.run(OPEN)
                for _ in range(60):  # a janelinha leva um instante pra existir; sem vídeo na página, não vem
                    time.sleep(0.05)
                    if self.state()["floating"]:
                        break
                steam = None
                if self.windows:
                    import steam as steam_app
                    steam = steam_app.big_picture_window()
                self.run(ARRANGE, away=self.windows, steam=steam, width=float(place["width"]), col=int(place["col"]), row=int(place["row"]))
                if not self.windows:
                    for _ in range(50):  # 5 s: o tempo de a janelinha tentar pegar o foco
                        time.sleep(0.1)
                        self.run(KEEP_FOCUS)
            finally:
                self.quiet_until = time.monotonic() + 1.5

    def back(self):
        """Start + Select lido direto do controle: se o TV Browser não é a janela da frente (está
        minimizado, atrás do Steam ou de um jogo), volta pra ele. Com ele na frente, quem trata o
        aperto é a extensão."""
        # Sem esperar a trava: se a extensão já está tratando este mesmo aperto, este aqui é o eco dele
        # (esperar faria a janelinha abrir e fechar em seguida).
        if not self.lock.acquire(blocking=False):
            return
        try:
            if time.monotonic() >= self.quiet_until and not self.state()["front"]:
                self.show()
                self.quiet_until = time.monotonic() + 1.5
        finally:
            self.lock.release()

    def guide(self):
        """Guia apertado sozinho: com o TV Browser na frente e o Big Picture aberto, vai pro Steam.
        Fora do TV Browser (num jogo, no próprio Steam) o Guia é assunto do Steam."""
        import steam
        target = steam.big_picture_window()
        if not target or not self.lock.acquire(blocking=False):
            return
        try:
            if self.state()["front"] and not self.run(HAND_OVER, target=target):
                steam.bring_to_front(target)
        finally:
            self.lock.release()

    def focus_page(self, wait=10):
        """Põe o foco na página, de novo assim que a aba em branco virar a tela inicial (ou o site)."""
        deadline = time.monotonic() + wait
        try:
            while True:
                with self.lock:
                    url = self.run(FOCUS_PAGE)
                if not url.startswith("about:") or time.monotonic() > deadline:
                    return
                time.sleep(0.3)
        except (OSError, RuntimeError):
            pass  # o Firefox fechou

    def show(self):
        """Traz o TV Browser pra frente, fechando a janelinha se houver."""
        handle = self.run(RESTORE)
        if self.windows:
            import steam
            steam.bring_to_front(int(handle, 16))

    def serve(self):
        """Fica à espera dos pedidos da extensão até o Firefox fechar."""
        try:
            rdp, console = tvbrowser.open_console(self.port, self.process, "extension")
            reason = blocked()
            if reason:
                rdp.evaluate(console, f"globalThis.pipBlocked = {json.dumps(reason)}")
            while True:
                place = json.loads(rdp.evaluate(console, "nextLauncherRequest()"))
                try:
                    self.toggle(place)
                except RuntimeError:
                    pass  # o navegador recusou desta vez; o próximo pedido tenta de novo
        except (OSError, RuntimeError, StopIteration):
            pass  # o Firefox fechou
