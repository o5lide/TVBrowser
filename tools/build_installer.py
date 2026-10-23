#!/usr/bin/env python3
"""Monta os instaladores de um arquivo só, para mandar a quem não tem nada instalado.

    python tools/build_installer.py

dist/TVBrowser.exe (Windows, só se monta no Windows): o Python que vai junto é copiado do Python
que está rodando este script (só o que o TV Browser usa, uns 12 MB), e o pacote auto-extraível é
feito pelo IExpress, que já vem no Windows. Dois cliques: os arquivos vão para
%LOCALAPPDATA%\\Programs\\TV Browser e abre a janela do instalar.py.

dist/TVBrowser-linux.run (Linux, monta em qualquer sistema): o script tools/linux/instalar.sh com
o pacote colado no fim. Usa o Python 3 do próprio sistema. Roda com `sh TVBrowser-linux.run`.

Nenhum dos dois leva o Firefox dentro, e montar não baixa nada: se faltar Firefox na máquina de
quem instala, o instalador busca o oficial na Mozilla.
"""
import io
import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
STAGE = DIST / "stage"
PYTHON = Path(sys.base_prefix)
VERSION = f"python{sys.version_info.major}{sys.version_info.minor}"

APP = ["tvbrowser.py", "steam.py", "pipmode.py", "instalar.py", "extension", "assets"]
# DLLs e módulos compilados que o lançador e o instalador usam (rede, janela, chamadas ao Windows)
BINARIES = ["python.exe", "pythonw.exe", "python3.dll", f"{VERSION}.dll", "vcruntime140.dll", "vcruntime140_1.dll", "LICENSE.txt",
            "DLLs/_socket.pyd", "DLLs/select.pyd", "DLLs/unicodedata.pyd", "DLLs/_queue.pyd", "DLLs/_ctypes.pyd", "DLLs/libffi-8.dll",
            "DLLs/_tkinter.pyd", "DLLs/tcl86t.dll", "DLLs/tk86t.dll", "DLLs/zlib1.dll"]
# pedaços da biblioteca padrão que não fazem falta e pesam
SKIP = {"test", "tests", "idlelib", "ensurepip", "lib2to3", "turtledemo", "pydoc_data", "venv", "site-packages", "__pycache__", "idle_test"}

SETUP = r"""@echo off
set "DEST=%LOCALAPPDATA%\Programs\TV Browser"
if not exist "%DEST%" mkdir "%DEST%"
tar -xf "%~dp0payload.zip" -C "%DEST%" 2>nul || powershell -NoProfile -Command "Expand-Archive -LiteralPath '%~dp0payload.zip' -DestinationPath $env:DEST -Force"
start "" "%DEST%\runtime\pythonw.exe" "%DEST%\instalar.py"
"""

SED = r"""[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName={target}
FriendlyName=TV Browser
AppLaunched=cmd /c setup.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[SourceFiles]
SourceFiles0={source}\
[SourceFiles0]
payload.zip=
setup.cmd=
"""


def stage_app():
    for name in APP:
        source = ROOT / name
        if source.is_dir():
            shutil.copytree(source, STAGE / name, ignore=shutil.ignore_patterns("__pycache__"))
        else:
            shutil.copy2(source, STAGE / name)


def stage_runtime():
    """Um Python mínimo, no mesmo arranjo da distribuição "embeddable" oficial."""
    runtime = STAGE / "runtime"
    runtime.mkdir()
    for name in BINARIES:
        shutil.copy2(PYTHON / name, runtime / Path(name).name)

    with zipfile.ZipFile(runtime / f"{VERSION}.zip", "w", zipfile.ZIP_DEFLATED) as library:
        for path in sorted((PYTHON / "Lib").rglob("*.py")):
            relative = path.relative_to(PYTHON / "Lib")
            if not SKIP.intersection(relative.parts):
                library.write(path, relative.as_posix())

    # o tkinter procura o Tcl/Tk em <runtime>\tcl
    for name in ("tcl8.6", "tk8.6", "tcl8"):
        shutil.copytree(PYTHON / "tcl" / name, runtime / "tcl" / name, ignore=shutil.ignore_patterns("demos", "tzdata", "*.lib"))

    # com este arquivo o Python ignora registro e variáveis de ambiente: só enxerga o que está listado
    # (".." é a pasta do TV Browser, onde ficam tvbrowser.py e steam.py)
    (runtime / f"{VERSION}._pth").write_text(f"{VERSION}.zip\n.\n..\n", encoding="ascii")


def check_runtime():
    """O Python empacotado tem que importar tudo que o TV Browser usa, sem ajuda do Python instalado."""
    # 'idna' é a codificação que o socket usa pro nome do host: sem o unicodedata, conectar falha
    code = "import tkinter, queue, ctypes, winreg, socket, json, zlib, argparse, threading; import tvbrowser, steam, pipmode, instalar; 'localhost'.encode('idna'); print('ok')"
    # -B: sem gravar __pycache__ dentro do que vai ser empacotado
    result = subprocess.run([str(STAGE / "runtime" / "python.exe"), "-B", "-c", code], capture_output=True, text=True, cwd=STAGE, env={"SystemRoot": "C:\\Windows"})
    if result.stdout.strip() != "ok":
        sys.exit(f"O Python empacotado não funciona sozinho:\n{result.stderr}")


def package():
    payload = DIST / "pack" / "payload.zip"
    payload.parent.mkdir()
    with zipfile.ZipFile(payload, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(STAGE.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(STAGE).as_posix())
    (payload.parent / "setup.cmd").write_text(SETUP, encoding="ascii", newline="\r\n")

    target = DIST / "TVBrowser.exe"
    sed = DIST / "pack" / "tvbrowser.sed"
    sed.write_text(SED.format(target=target, source=payload.parent), encoding="mbcs")
    subprocess.run(["iexpress", "/N", "/Q", str(sed)], check=True)
    if not target.is_file():
        sys.exit("O IExpress não gerou o arquivo.")
    return target, payload


def build_linux():
    """Script de instalação + pacote .tar.gz num arquivo só (o script acha o pacote depois de __PAYLOAD__)."""
    sources = [(ROOT / name, name) for name in ("tvbrowser.py", "steam.py", "pipmode.py", "tvbrowser.sh")]
    sources.append((ROOT / "tools" / "linux" / "desinstalar.sh", "desinstalar.sh"))
    for folder in ("extension", "assets"):
        sources += [(path, path.relative_to(ROOT).as_posix()) for path in sorted((ROOT / folder).rglob("*")) if path.is_file()]

    packed = io.BytesIO()
    with tarfile.open(fileobj=packed, mode="w:gz") as archive:
        for path, name in sources:
            data = path.read_bytes()
            script = name.endswith(".sh")
            if script:
                data = data.replace(b"\r\n", b"\n")  # com fim de linha do Windows o Linux não acha o /bin/sh
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.mtime = len(data), 0o755 if script else 0o644, path.stat().st_mtime
            archive.addfile(info, io.BytesIO(data))

    header = (ROOT / "tools" / "linux" / "instalar.sh").read_bytes().replace(b"\r\n", b"\n")
    if not header.endswith(b"\n__PAYLOAD__\n"):
        sys.exit("tools/linux/instalar.sh tem que terminar na linha __PAYLOAD__.")
    target = DIST / "TVBrowser-linux.run"
    target.write_bytes(header + packed.getvalue())
    return target


def main():
    shutil.rmtree(DIST, ignore_errors=True)
    STAGE.mkdir(parents=True)
    targets = [build_linux()]
    if sys.platform == "win32":
        stage_app()
        stage_runtime()
        check_runtime()
        targets.append(package()[0])
    else:
        print("O instalador do Windows só se monta no Windows; montei só o do Linux.")
    for target in targets:
        print(f"{target}  ({target.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
