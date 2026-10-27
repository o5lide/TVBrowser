#!/usr/bin/env python3
"""Teste do picture-in-picture pelo lançador de verdade (tvbrowser.py), com o Firefox sem janela.

Abre uma página com vídeo e aperta F3 (o equivalente, no teclado, ao Start + Select). O caminho
inteiro tem que funcionar: a extensão na página recebe a tecla, pede à página de fundo, o lançador
ouve e abre a janelinha. O segundo F3 fecha. Depende de nomes internos do Firefox (o ator
PictureInPictureLauncher): se uma atualização mudar isso, é aqui que aparece.

    python tests/pip_test.py
"""
import functools
import http.server
import json
import re
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import pipmode  # noqa: E402
import tvbrowser  # noqa: E402


# Tecla de verdade (isTrusted), entregue à página pelo próprio navegador.
PRESS_F3 = """(() => {
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  win.gBrowser.selectedBrowser.focus();
  const typist = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
  typist.beginInputTransactionForTests(win);
  const key = new win.KeyboardEvent("", { key: "F3", code: "F3", keyCode: win.KeyboardEvent.DOM_VK_F3 });
  typist.keydown(key);
  typist.keyup(key);
})()"""


# Onde a janelinha está, como fração da tela.
WHERE = """(() => {
  const [floating] = Services.wm.getEnumerator("Toolkit:PictureInPicture");
  const area = floating.screen;
  const share = (value, total) => Math.round(100 * value / total) / 100;
  return JSON.stringify({ left: share(floating.screenX - area.availLeft, area.availWidth), top: share(floating.screenY - area.availTop, area.availHeight),
                          width: share(floating.outerWidth, area.availWidth) });
})()"""


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def debugger_port(profile):
    """A porta de depuração que o lançador sorteou, lida da linha de comando do Firefox que ele abriu."""
    for _ in range(60):
        time.sleep(0.5)
        listing = subprocess.run(["powershell", "-NoProfile", "-Command",
                                  "Get-CimInstance Win32_Process -Filter \"Name='firefox.exe'\" | ForEach-Object CommandLine"],
                                 capture_output=True, text=True).stdout if sys.platform == "win32" else \
            subprocess.run(["ps", "-eo", "args"], capture_output=True, text=True).stdout
        for line in listing.splitlines():
            found = re.search(r"-start-debugger-server (\d+)", line)
            if found and profile.name in line:
                return int(found.group(1))
    sys.exit("o lançador não abriu o Firefox")


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT / "tests")))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        profile = Path(tmp)
        launcher = subprocess.Popen([sys.executable, str(ROOT / "tvbrowser.py"), "--headless", "--profile", str(profile),
                                     "--url", f"http://127.0.0.1:{server.server_port}/video.html"])
        port = None
        try:
            port = debugger_port(profile)
            time.sleep(8)  # extensão carregada, vídeo tocando, lançador já à espera de pedidos
            rdp, chrome = tvbrowser.open_console(port, launcher, "chrome")
            state = lambda: json.loads(rdp.evaluate(chrome, pipmode.script(pipmode.STATE, windows=False)))
            ask = lambda: rdp.evaluate(chrome, PRESS_F3)

            print("antes:", state())
            ask()
            time.sleep(5)
            opened = state()
            print("depois do 1º F3:", opened)
            if opened["floating"]:
                # sem escolha guardada: embaixo à direita, um terço da largura
                print("  lugar padrão:", rdp.evaluate(chrome, WHERE))
                rdp.evaluate(chrome, pipmode.script(pipmode.ARRANGE, away=False, steam=None, width=0.5, col=0, row=0))
                time.sleep(1)
                print("  pedindo em cima à esquerda, metade da largura:", rdp.evaluate(chrome, WHERE))
            ask()
            time.sleep(3)
            closed = state()
            print("depois do 2º F3:", closed)
            ok = opened["floating"] == 1 and closed["floating"] == 0
            print("picture-in-picture pelo lançador:", "ok" if ok else "FALHOU")
            return 0 if ok else 1
        finally:
            # com a porta, fecha o próprio Firefox; matar só o lançador deixava o do Flatpak aberto
            tvbrowser.kill(launcher, port)


if __name__ == "__main__":
    sys.exit(main())
