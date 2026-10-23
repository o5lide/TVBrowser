"""Põe o TV Browser na biblioteca do Steam como jogo não-Steam, já com a arte.

O Steam guarda os atalhos em userdata/<conta>/config/shortcuts.vdf (um formato binário simples) e a
arte em userdata/<conta>/config/grid/, com o número do atalho no nome do arquivo. Só biblioteca padrão.
"""
import os
import shutil
import struct
import subprocess
import sys
import time
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NAME = "TV Browser"
MAP, STRING, INT, END = 0x00, 0x01, 0x02, 0x08
# arquivo da arte -> sufixo que o Steam espera depois do número do atalho
ART = {"steam/capsule.png": "p.png", "steam/wide.png": ".png", "steam/hero.png": "_hero.png", "steam/logo.png": "_logo.png"}


# ---------- formato binário do shortcuts.vdf ----------

def parse(data, pos=0):
    """Lê um mapa: sequência de (tipo, chave, valor) terminada por END. Devolve (dict, posição)."""
    out = {}
    while pos < len(data) and data[pos] != END:
        kind = data[pos]
        end = data.index(b"\x00", pos + 1)
        key = data[pos + 1:end].decode("utf-8")
        pos = end + 1
        if kind == MAP:
            out[key], pos = parse(data, pos)
        elif kind == STRING:
            end = data.index(b"\x00", pos)
            out[key] = data[pos:end].decode("utf-8", "surrogateescape")
            pos = end + 1
        elif kind == INT:
            out[key] = struct.unpack_from("<I", data, pos)[0]
            pos += 4
        else:
            raise ValueError(f"tipo {kind:#x} desconhecido no shortcuts.vdf (chave {key!r})")
    return out, pos + 1


def dump(mapping):
    out = bytearray()
    for key, value in mapping.items():
        name = key.encode("utf-8") + b"\x00"
        if isinstance(value, dict):
            out += bytes([MAP]) + name + dump(value)
        elif isinstance(value, str):
            out += bytes([STRING]) + name + value.encode("utf-8", "surrogateescape") + b"\x00"
        else:
            out += bytes([INT]) + name + struct.pack("<I", value)
    return bytes(out) + bytes([END])


# ---------- onde está o Steam ----------

def find_steam():
    candidates = []
    if sys.platform == "win32":
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as key:
                candidates.append(winreg.QueryValueEx(key, "SteamPath")[0])
        except OSError:
            pass
        candidates.append(os.path.join(os.environ.get("ProgramFiles(x86)", ""), "Steam"))
    else:
        home = Path.home()
        candidates += [home / ".local/share/Steam", home / ".steam/steam", home / ".var/app/com.valvesoftware.Steam/.local/share/Steam"]
    for path in candidates:
        if (Path(path) / "userdata").is_dir():
            return Path(path)
    return None


def accounts(steam):
    """Pastas de conta que já abriram o Steam nesta máquina (a '0' é um resto sem conta)."""
    return [d for d in (steam / "userdata").iterdir() if d.name.isdigit() and d.name != "0" and (d / "config").is_dir()]


def steam_running():
    if sys.platform == "win32":
        listing = subprocess.run(["tasklist", "/FI", "IMAGENAME eq steam.exe", "/NH"], capture_output=True, text=True).stdout
        return "steam.exe" in listing.lower()
    return subprocess.run(["pgrep", "-x", "steam"], capture_output=True).returncode == 0


# ---------- trazer o Big Picture de volta (Windows) ----------
# O Windows não deixa um programa em segundo plano tomar a frente da tela, e o Steam esbarra nisso
# com o Firefox aberto: o Guia não traz o Big Picture por cima, e quando o TV Browser fecha o Big
# Picture fica sem foco (o controle não responde até clicar nele com o mouse).

def _win32():
    """user32 e kernel32 com os tipos declarados (janela e processo são ponteiros de 64 bits)."""
    import ctypes
    from ctypes import wintypes
    user32, kernel32 = ctypes.windll.user32, ctypes.windll.kernel32
    for name in ("IsWindowVisible", "IsIconic", "SetForegroundWindow"):
        getattr(user32, name).argtypes = [wintypes.HWND]
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.BringWindowToTop.argtypes = [wintypes.HWND]
    user32.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    return user32, kernel32


def _process_name(pid):
    import ctypes
    from ctypes import wintypes
    kernel32 = _win32()[1]
    handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return ""
    try:
        size = wintypes.DWORD(260)
        path = ctypes.create_unicode_buffer(size.value)
        kernel32.QueryFullProcessImageNameW(handle, 0, path, ctypes.byref(size))
        return Path(path.value).name.lower()
    finally:
        kernel32.CloseHandle(handle)


def big_picture_window():
    """A janela do Big Picture ("Steam — Modo Big Picture" em português), se estiver aberta."""
    import ctypes
    from ctypes import wintypes
    user32 = _win32()[0]
    found = []

    def check(hwnd, _):
        title = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(hwnd, title, 256)
        if user32.IsWindowVisible(hwnd) and "Big Picture" in title.value:
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if _process_name(pid.value) in ("steamwebhelper.exe", "steam.exe"):
                found.append(hwnd)
                return False
        return True

    user32.EnumWindows(ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)(check), 0)
    return found[0] if found else None


def bring_to_front(hwnd):
    """Põe a janela na frente a partir de um programa em segundo plano, que é o que o Windows barra.
    Três tentativas, da mais limpa pra mais invasiva. Devolve se ela ficou na frente."""
    user32, kernel32 = _win32()
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    if user32.SetForegroundWindow(hwnd) and user32.GetForegroundWindow() == hwnd:
        return True
    # entrar na fila de entrada de quem está na frente dá o direito de trocar a janela
    front = user32.GetForegroundWindow()
    theirs = user32.GetWindowThreadProcessId(front, None) if front else 0
    mine = kernel32.GetCurrentThreadId()
    if theirs and theirs != mine and user32.AttachThreadInput(mine, theirs, True):
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)
        user32.AttachThreadInput(mine, theirs, False)
        if user32.GetForegroundWindow() == hwnd:
            return True
    # um Alt "de mentira": depois de uma tecla o Windows aceita a troca
    user32.keybd_event(0x12, 0, 0, 0)
    user32.keybd_event(0x12, 0, 2, 0)
    user32.SetForegroundWindow(hwnd)
    return user32.GetForegroundWindow() == hwnd


def focus_big_picture():
    window = big_picture_window()
    return bool(window) and bring_to_front(window)


def watch_guide(stop, on_guide, on_chord):
    """Até `stop` disparar, lê o controle direto do Windows e avisa de dois apertos:
    `on_guide()` quando o Guia é apertado e solto sozinho, `on_chord()` quando Start e Select ficam
    apertados juntos. O que fazer com cada um quem decide é o pipmode.py.

    Lê pelo XInput; só a versão "Ex" (sem nome, número 100) conta o botão Guia. Guia usado em
    combinação do Steam (Guia + analógico = volume, Guia + RB = captura) não conta como sozinho.
    """
    import ctypes
    try:
        get_state = ctypes.WinDLL("xinput1_4.dll")[100]
    except (OSError, AttributeError):
        return

    class State(ctypes.Structure):
        _fields_ = [("packet", ctypes.c_uint32), ("buttons", ctypes.c_uint16), ("lt", ctypes.c_uint8),
                    ("rt", ctypes.c_uint8), ("lx", ctypes.c_int16), ("ly", ctypes.c_int16),
                    ("rx", ctypes.c_int16), ("ry", ctypes.c_int16), ("reserved", ctypes.c_uint32)]

    GUIDE, CHORD = 0x0400, 0x0010 | 0x0020  # Start | Select
    state = State()
    alone = {}  # controle -> Guia segurado sem mexer em mais nada até agora
    chord = set()  # controles com Start + Select apertados (pra disparar uma vez só por aperto)
    while not stop.wait(0.03):
        for pad in range(4):
            if get_state(pad, ctypes.byref(state)) != 0:
                alone.pop(pad, None)
                chord.discard(pad)
                continue
            if state.buttons & CHORD != CHORD:
                chord.discard(pad)
            elif pad not in chord:
                chord.add(pad)
                on_chord()
            other = (state.buttons & ~GUIDE or state.lt > 64 or state.rt > 64
                     or max(abs(state.lx), abs(state.ly), abs(state.rx), abs(state.ry)) > 16000)
            if state.buttons & GUIDE:
                alone[pad] = alone.get(pad, True) and not other
            elif alone.pop(pad, False):
                on_guide()


# ---------- o atalho ----------

def launch_command():
    """(executável, pasta, opções) que abrem o TV Browser e ficam vivos até ele fechar."""
    if sys.platform == "win32":
        windowless = Path(sys.executable).with_name("pythonw.exe")
        exe = windowless if windowless.is_file() else Path(sys.executable)
        return f'"{exe}"', str(ROOT), f'"{ROOT / "tvbrowser.py"}"'
    return f'"{ROOT / "tvbrowser.sh"}"', str(ROOT), ""


def shortcut_id(exe, name):
    """Número que o Steam e as ferramentas de arte usam para um atalho não-Steam."""
    return zlib.crc32((exe + name).encode("utf-8")) | 0x80000000


def is_ours(entry):
    text = " ".join(str(entry.get(k, "")) for k in ("Exe", "LaunchOptions")).lower()
    return "tvbrowser.py" in text or "tvbrowser.sh" in text or entry.get("AppName", "").lower() == NAME.lower()


def points_here(entry):
    """O atalho já abre o TV Browser desta pasta? (aí não precisa mexer no arquivo de atalhos)"""
    exe, _, options = launch_command()
    same = lambda a, b: os.path.normcase(a.strip('"')) == os.path.normcase(b.strip('"'))
    return same(entry.get("Exe", ""), exe) and same(entry.get("LaunchOptions", ""), options)


def read_shortcuts(account):
    path = account / "config" / "shortcuts.vdf"
    root = parse(path.read_bytes())[0] if path.is_file() and path.stat().st_size else {}
    shortcuts = root.setdefault("shortcuts", {})
    key = next((k for k, entry in shortcuts.items() if is_ours(entry)), None)
    return path, root, shortcuts, key


def write_shortcut(account):
    """Cria o atalho ou aponta o que já existe para esta pasta. Só com o Steam fechado."""
    path, root, shortcuts, key = read_shortcuts(account)
    exe, start, options = launch_command()
    if key is None:
        key = str(len(shortcuts))
        shortcuts[key] = {
            "appid": shortcut_id(exe, NAME), "AppName": NAME, "Exe": exe, "StartDir": start, "icon": "",
            "ShortcutPath": "", "LaunchOptions": options, "IsHidden": 0, "AllowDesktopConfig": 1, "AllowOverlay": 1,
            "OpenVR": 0, "Devkit": 0, "DevkitGameID": "", "DevkitOverrideAppID": 0, "LastPlayTime": 0,
            "FlatpakAppID": "", "tags": {},
        }
    # atalho que já existia mantém o número (e com ele horas jogadas, coleções e configuração de controle)
    shortcuts[key].update({"Exe": exe, "StartDir": start, "LaunchOptions": options, "icon": str(ROOT / "assets" / "icon.png")})
    if path.is_file():
        shutil.copy2(path, path.with_name("shortcuts.vdf.antes-do-tvbrowser"))
    path.write_bytes(dump(root))
    return shortcuts[key]


def copy_art(account, appid):
    grid = account / "config" / "grid"
    grid.mkdir(exist_ok=True)
    for source, suffix in ART.items():
        target = grid / f"{appid}{suffix}"
        # o Steam aceita .png ou .jpg: uma capa antiga em .jpg ganharia da nova
        for old in grid.glob(f"{target.stem}.*"):
            if old.stem == target.stem:
                old.unlink()
        shutil.copyfile(ROOT / "assets" / source, target)


def install(say=print):
    """`say`: para onde vão os avisos (o instalador com janela passa o dele)."""
    steam = find_steam()
    if not steam:
        say("O Steam não foi encontrado neste computador.")
        return 1
    users = accounts(steam)
    if not users:
        say(f"Nenhuma conta do Steam foi encontrada em {steam}.")
        return 1

    def ready(account):
        _, _, shortcuts, key = read_shortcuts(account)
        return key is not None and points_here(shortcuts[key])

    # Com o Steam aberto ele regrava o arquivo de atalhos por cima do nosso ao fechar: mexer no
    # atalho só com ele fechado. Trocar a arte de um atalho que já está certo pode a qualquer hora.
    was_running = steam_running()
    if was_running and not all(ready(account) for account in users):
        say("O Steam está em execução. Encerre-o (Steam > Sair) para que a instalação continue.")
        while steam_running():
            time.sleep(1)
        time.sleep(2)

    for account in users:
        if ready(account):
            _, _, shortcuts, key = read_shortcuts(account)
            entry, what = shortcuts[key], "atalho existente"
        else:
            entry, what = write_shortcut(account), "atalho criado"
        copy_art(account, entry["appid"])
        say(f"Conta {account.name}: {what} (nº {entry['appid']}); arte aplicada.")

    if steam_running():
        say("Concluído. Reinicie o Steam para exibir a nova arte.")
    else:
        say("Concluído. O TV Browser está disponível na biblioteca do Steam, em jogos não Steam.")
    return 0


def uninstall():
    """Tira do Steam o atalho que aponta para esta pasta, e a arte dele.

    Devolve False se havia atalho mas o Steam estava aberto: aí fica para a pessoa remover por lá.
    """
    steam = find_steam()
    if not steam:
        return True
    found = [(account, *read_shortcuts(account)) for account in accounts(steam)]
    found = [item for item in found if item[4] is not None and points_here(item[3][item[4]])]
    if found and steam_running():
        return False
    for account, path, root, shortcuts, key in found:
        appid = shortcuts.pop(key)["appid"]
        root["shortcuts"] = {str(index): entry for index, entry in enumerate(shortcuts.values())}  # sem buraco na numeração
        shutil.copy2(path, path.with_name("shortcuts.vdf.antes-do-tvbrowser"))
        path.write_bytes(dump(root))
        for suffix in ART.values():
            (account / "config" / "grid" / f"{appid}{suffix}").unlink(missing_ok=True)
    return True
