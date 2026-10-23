#!/usr/bin/env python3
"""Abre o TV Browser: Firefox em modo quiosque, com perfil próprio e a extensão de controle carregada.

Só usa a biblioteca padrão do Python, no Windows e no Linux.

O Firefox comum não instala extensão sem assinatura da Mozilla. Então a extensão entra como
"extensão temporária" pelo protocolo de depuração remota, que é o que o about:debugging faz
por baixo. Ela vale até o Firefox fechar, por isso é recarregada a cada abertura.
"""
import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXTENSION = ROOT / "extension"
ADDON_ID = "tvbrowser@isaac.local"  # o mesmo de extension/manifest.json

PREFS = {
    # servidor de depuração: só escuta em localhost, e só serve pra carregar a extensão
    "devtools.debugger.remote-enabled": True,
    "devtools.chrome.enabled": True,
    "devtools.debugger.prompt-connection": False,
    # sem telas de boas-vindas, avisos e perguntas que não dá pra responder com controle
    "browser.shell.checkDefaultBrowser": False,
    "browser.aboutwelcome.enabled": False,
    "browser.startup.homepage_override.mstone": "ignore",
    "startup.homepage_welcome_url": "",
    "startup.homepage_welcome_url.additional": "",
    "datareporting.policy.dataSubmissionPolicyBypassNotification": True,
    "browser.sessionstore.resume_from_crash": False,
    "browser.tabs.warnOnClose": False,
    "browser.translations.automaticallyPopup": False,
    "full-screen-api.warning.timeout": 0,
    "ui.key.menuAccessKeyFocuses": False,
    # tudo na mesma aba: TV não tem barra de abas
    "browser.link.open_newwindow": 1,
    "browser.link.open_newwindow.restriction": 0,
    # streaming: DRM ligado e vídeo com som começando sozinho
    "media.eme.enabled": True,
    "media.gmp-widevinecdm.enabled": True,
    "media.autoplay.default": 0,
    "media.autoplay.blocking_policy": 0,
    "media.autoplay.block-webaudio": False,  # os sons da interface tocam sem clique de mouse antes
}


def data_dir():
    if sys.platform == "win32":
        return Path(os.environ["LOCALAPPDATA"]) / "TvBrowser"
    base = os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share"
    return Path(base) / "tvbrowser"


def find_firefox(profile):
    """Devolve o comando (lista) que abre o Firefox, ou None."""
    custom = os.environ.get("TVBROWSER_FIREFOX")
    if custom:
        return [custom]
    # primeiro o Firefox só nosso, que o instalador baixa pra quem não tem nenhum
    # (instalar.py no Windows, tools/linux/instalar.sh no Linux)
    for exe in (ROOT / "firefox" / "firefox.exe", ROOT / "firefox" / "core" / "firefox.exe", ROOT / "firefox" / "firefox"):
        if exe.is_file():
            return [str(exe)]
    if sys.platform == "win32":
        for var in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
            exe = Path(os.environ.get(var, "")) / "Mozilla Firefox" / "firefox.exe"
            if exe.is_file():
                return [str(exe)]
    exe = shutil.which("firefox")
    if exe:
        return [exe]
    # Bazzite e afins trazem o Firefox em Flatpak: a sandbox precisa enxergar a extensão e o perfil.
    if shutil.which("flatpak"):
        app = "org.mozilla.firefox"
        if subprocess.run(["flatpak", "info", app], capture_output=True).returncode == 0:
            return ["flatpak", "run", f"--filesystem={ROOT}:ro", f"--filesystem={profile}", app]
    return None


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def write_prefs(profile):
    lines = [f"user_pref({json.dumps(name)}, {json.dumps(value)});" for name, value in PREFS.items()]
    (profile / "user.js").write_text("\n".join(lines) + "\n", encoding="utf-8")


class Rdp:
    """Cliente mínimo do protocolo de depuração do Firefox: pacotes 'tamanho:json'."""

    def __init__(self, sock):
        self.sock = sock
        self.buffer = b""

    def _more(self):
        chunk = self.sock.recv(65536)
        if not chunk:
            raise ConnectionError("o Firefox fechou a conexão de depuração")
        self.buffer += chunk

    def receive(self):
        while b":" not in self.buffer:
            self._more()
        size, _, self.buffer = self.buffer.partition(b":")
        size = int(size)
        while len(self.buffer) < size:
            self._more()
        packet, self.buffer = self.buffer[:size], self.buffer[size:]
        return json.loads(packet)

    def send(self, packet):
        data = json.dumps(packet).encode()
        self.sock.sendall(str(len(data)).encode() + b":" + data)

    def request(self, packet, answer_key):
        """Manda o pacote e espera a resposta que traz `answer_key` (eventos soltos são ignorados)."""
        self.send(packet)
        while True:
            reply = self.receive()
            if reply.get("from") != packet["to"]:
                continue
            if "error" in reply:
                raise RuntimeError(f"{reply['error']}: {reply.get('message', '')}")
            if answer_key in reply:
                return reply

    def evaluate(self, console, text):
        """Roda JavaScript num console do Firefox e devolve o resultado; se for promessa, espera ela."""
        result_id = self.request({"to": console, "type": "evaluateJSAsync", "text": text, "mapped": {"await": True}}, "resultID")["resultID"]
        while True:
            packet = self.receive()
            if packet.get("type") == "evaluationResult" and packet.get("resultID") == result_id:
                if packet.get("hasException"):
                    raise RuntimeError(packet.get("exceptionMessage") or "erro no JavaScript")
                return packet.get("result")


def open_console(port, process, where):
    """Abre uma conexão de depuração e devolve (rdp, console) para rodar JavaScript lá dentro.

    where="chrome": o próprio navegador, com todos os privilégios (janelas, picture-in-picture).
    where="extension": a página de fundo da nossa extensão.
    """
    sock = connect(port, process)
    sock.settimeout(None)  # quem espera pedido da extensão fica parado aqui por horas
    rdp = Rdp(sock)
    rdp.receive()
    if where == "chrome":
        descriptor = rdp.request({"to": "root", "type": "getProcess", "id": 0}, "processDescriptor")["processDescriptor"]["actor"]
        return rdp, rdp.request({"to": descriptor, "type": "getTarget"}, "process")["process"]["consoleActor"]

    addons = rdp.request({"to": "root", "type": "listAddons"}, "addons")["addons"]
    descriptor = next(addon["actor"] for addon in addons if addon["id"] == ADDON_ID)
    watcher = rdp.request({"to": descriptor, "type": "getWatcher", "isServerTargetSwitchingEnabled": True}, "actor")["actor"]
    # O watcher avisa de cada página da extensão (a de fundo, a tela inicial...) e só depois responde.
    rdp.send({"to": watcher, "type": "watchTargets", "targetType": "frame"})
    while True:
        packet = rdp.receive()
        if packet.get("type") == "target-available-form" and "_generated_background_page" in (packet["target"].get("url") or ""):
            return rdp, packet["target"]["consoleActor"]
        if packet.get("from") == watcher and "type" not in packet:
            raise RuntimeError("não achei a página de fundo da extensão")


def connect(port, process, timeout=90):
    """`process`: o Firefox que acabamos de abrir, pra desistir cedo se ele morrer (None se não é nosso)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process and process.poll() is not None:
            raise RuntimeError("o Firefox fechou antes de carregar (já tem um TV Browser aberto?)")
        try:
            return socket.create_connection(("127.0.0.1", port), timeout=30)
        except OSError:
            time.sleep(0.3)
    raise RuntimeError("o Firefox não abriu a porta de depuração a tempo")


def install_extension(port, process):
    with connect(port, process) as sock:
        rdp = Rdp(sock)
        rdp.receive()  # saudação
        root = rdp.request({"to": "root", "type": "getRoot"}, "addonsActor")
        reply = rdp.request(
            {"to": root["addonsActor"], "type": "installTemporaryAddon", "addonPath": str(EXTENSION)},
            "addon",
        )
        return reply["addon"]["id"]


def instance_file():
    return data_dir() / "aberto.json"


def show_running():
    """Se já há um TV Browser aberto, traz ele pra frente e devolve True.

    Abrir outro com o mesmo perfil só daria o erro "o Firefox já está em execução". O que está
    aberto deixa a porta de depuração anotada em aberto.json.
    """
    try:
        port = json.loads(instance_file().read_text(encoding="utf-8"))["port"]
        socket.create_connection(("127.0.0.1", port), timeout=1).close()
        import pipmode
        pipmode.Pip(port, None, windows=sys.platform == "win32").show()
        return True
    except (OSError, ValueError, KeyError, RuntimeError):
        return False


def kill(process):
    # No Windows o firefox.exe que abrimos é só um lançador; o navegador de verdade é filho dele.
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
    else:
        process.terminate()


def main():
    parser = argparse.ArgumentParser(description="TV Browser")
    parser.add_argument("--url", help="abre direto neste endereço em vez da tela inicial")
    parser.add_argument("--windowed", action="store_true", help="janela comum em vez de quiosque (para desenvolver)")
    parser.add_argument("--headless", action="store_true", help="sem janela (para testes)")
    parser.add_argument("--check", action="store_true", help="só confere se o Firefox abre e a extensão carrega, e sai")
    parser.add_argument("--profile", help="pasta do perfil (padrão: dados do usuário)")
    parser.add_argument("--steam", action="store_true", help="põe o TV Browser na biblioteca do Steam, com a arte, e sai")
    args = parser.parse_args()

    if args.steam:
        import steam
        return steam.install()

    own_profile = not args.profile and not args.headless and not args.check
    if own_profile and show_running():
        return 0
    profile = Path(args.profile).resolve() if args.profile else data_dir() / "perfil"
    profile.mkdir(parents=True, exist_ok=True)

    firefox = find_firefox(profile)
    if not firefox:
        sys.exit("Firefox não encontrado. Instale o Firefox ou aponte TVBROWSER_FIREFOX para o executável.")

    write_prefs(profile)
    port = free_port()
    command = firefox + ["-no-remote", "-profile", str(profile), "-start-debugger-server", str(port)]
    if sys.platform == "win32":
        command.append("-wait-for-browser")
    if args.headless:
        command.append("-headless")
    elif not args.windowed:
        command.append("--kiosk")
    command.append(args.url or "about:blank")

    process = subprocess.Popen(command)
    try:
        addon_id = install_extension(port, process)
    except Exception as error:
        kill(process)
        sys.exit(f"Não consegui carregar a extensão: {error}")

    if args.check:
        print(f"ok: Firefox abriu e a extensão {addon_id} carregou")
        kill(process)
        return 0
    # Start + Select: a extensão pede o picture-in-picture e quem executa é o lançador (pipmode.py).
    import pipmode
    floating = pipmode.Pip(port, process, windows=sys.platform == "win32" and not args.headless)
    threading.Thread(target=floating.serve, daemon=True).start()
    if own_profile:
        instance_file().write_text(json.dumps({"port": port}), encoding="utf-8")
    try:
        if sys.platform != "win32" or args.headless:
            return process.wait()

        # Aberto pelo Big Picture: o Guia passa a frente pro Steam, Start + Select traz o TV Browser de
        # volta de onde ele estiver, e fechar devolve o foco ao Big Picture.
        import steam
        stop = threading.Event()
        threading.Thread(target=steam.watch_guide, args=(stop, floating.guide, floating.back), daemon=True).start()
        code = process.wait()
        stop.set()
        steam.focus_big_picture()
        return code
    finally:
        if own_profile:
            instance_file().unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
