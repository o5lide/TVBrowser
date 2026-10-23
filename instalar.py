#!/usr/bin/env python3
"""Instalador do TV Browser para Windows, com janela.

Roda de dentro da pasta já instalada: o pacote feito por tools/build_installer.py extrai tudo em
%LOCALAPPDATA%\\Programs\\TV Browser e chama este arquivo com o Python que vem junto. Daqui para
frente: garantir um Firefox, criar os atalhos, pôr no Steam e registrar a desinstalação.

    instalar.py               assistente de instalação
    instalar.py --uninstall   desinstala (é o que o "Aplicativos instalados" do Windows chama)
"""
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import winreg
from pathlib import Path

import steam
import tvbrowser

ROOT = Path(__file__).resolve().parent
PYTHONW = Path(sys.executable).with_name("pythonw.exe")
MARKER = ROOT / "instalado.txt"  # só existe em cópia instalada: é o que autoriza a desinstalação a apagar a pasta
FIREFOX_SETUP = "https://download.mozilla.org/?product=firefox-latest-ssl&os=win64&lang=pt-BR"
UNINSTALL_KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\TVBrowser"
HIDDEN = subprocess.CREATE_NO_WINDOW

# Aparência: neutra e escura, com o verde-limão do TV Browser só no que é ação ou está marcado.
BG, HEADER, PANEL = "#111411", "#0b0d0b", "#181c18"
BORDER, BORDER_STRONG = "#2a312a", "#4a554a"
TEXT, MUTED, DISABLED = "#e9ede7", "#9aa49a", "#566056"
ACCENT, ACCENT_HOVER, INK, ERROR = "#d8f52a", "#e6ff5c", "#10140a", "#ff8f73"
FONT, FONT_BOLD = "Segoe UI", "Segoe UI Semibold"


def powershell(script):
    subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], creationflags=HIDDEN, check=True)


def quoted(value):
    """Texto dentro de aspas simples do PowerShell."""
    return "'" + str(value).replace("'", "''") + "'"


def shortcuts(create):
    """Atalho "TV Browser" na Área de Trabalho e no Menu Iniciar (ou a remoção deles)."""
    action = f"""
        $link = $shell.CreateShortcut($path)
        $link.TargetPath = {quoted(PYTHONW)}
        $link.Arguments = {quoted(f'"{ROOT / "tvbrowser.py"}"')}
        $link.WorkingDirectory = {quoted(ROOT)}
        $link.IconLocation = {quoted(ROOT / "assets" / "icon.ico")}
        $link.Save()""" if create else "if (Test-Path $path) { Remove-Item $path }"
    powershell(f"""
        $shell = New-Object -ComObject WScript.Shell
        foreach ($folder in 'Desktop', 'Programs') {{
            $path = Join-Path ([Environment]::GetFolderPath($folder)) 'TV Browser.lnk'
            {action}
        }}""")


def has_firefox():
    return bool(tvbrowser.find_firefox(tvbrowser.data_dir() / "perfil"))


def download_size(url):
    """Tamanho do arquivo, pelo cabeçalho (0 se o servidor não disser)."""
    headers = subprocess.run(["curl.exe", "-sIL", url], capture_output=True, text=True, creationflags=HIDDEN).stdout
    sizes = re.findall(r"(?im)^content-length:\s*(\d+)", headers)
    return int(sizes[-1]) if sizes else 0


def ensure_firefox(say):
    """Sem Firefox na máquina, baixa o instalador oficial da Mozilla e extrai uma cópia só nossa.

    /ExtractDir só desempacota: não instala, não pede administrador, não vira navegador padrão.
    `say(texto, fração)`: a fração, de 0 a 1, é o andamento desta etapa.
    """
    if has_firefox():
        return
    setup = Path(os.environ["TEMP"]) / "tvbrowser-firefox-setup.exe"
    say("Baixando o Mozilla Firefox...", 0)
    total = download_size(FIREFOX_SETUP)
    download = subprocess.Popen(["curl.exe", "-L", "--fail", "--silent", "-o", str(setup), FIREFOX_SETUP], creationflags=HIDDEN)
    while download.poll() is None:
        time.sleep(0.3)
        done = setup.stat().st_size if setup.is_file() else 0
        say(f"Baixando o Mozilla Firefox... {done / 1e6:.0f} MB" + (f" de {total / 1e6:.0f} MB" if total else ""), 0.85 * done / total if total else 0)
    if download.returncode:
        raise RuntimeError("Não foi possível baixar o Mozilla Firefox. Verifique a conexão com a internet e tente novamente.")
    try:
        # só roda o que baixou se a assinatura digital for mesmo da Mozilla
        say("Verificando a assinatura digital...", 0.88)
        powershell(f"$s = Get-AuthenticodeSignature {quoted(setup)}; "
                   "if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'Mozilla Corporation') { exit 1 }")
        say("Extraindo os arquivos do Mozilla Firefox...", 0.92)
        subprocess.run([str(setup), f"/ExtractDir={ROOT / 'firefox'}"], check=True)
    except subprocess.CalledProcessError:
        raise RuntimeError("O arquivo do Mozilla Firefox não passou na verificação. Tente novamente.") from None
    finally:
        setup.unlink(missing_ok=True)
    if not has_firefox():
        raise RuntimeError("Não foi possível preparar o Mozilla Firefox.")


def register_uninstall():
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY) as key:
        for name, value in {
            "DisplayName": "TV Browser",
            "DisplayIcon": str(ROOT / "assets" / "icon.ico"),
            "InstallLocation": str(ROOT),
            "UninstallString": f'"{PYTHONW}" "{ROOT / "instalar.py"}" --uninstall',
        }.items():
            winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)
        for name in ("NoModify", "NoRepair"):
            winreg.SetValueEx(key, name, 0, winreg.REG_DWORD, 1)


def install(want_shortcuts, want_steam, say):
    """`say(texto, fração)`: a barra vai até 70% no Firefox e o resto nas outras etapas."""
    ensure_firefox(lambda text, part=0: say(text, 0.7 * part))
    if want_shortcuts:
        say("Criando os atalhos...", 0.75)
        shortcuts(True)
    if want_steam:
        say("Registrando o TV Browser no Steam...", 0.85)
        steam.install(lambda text: say(text, 0.85))
    say("Finalizando...", 0.95)
    MARKER.write_text("TV Browser instalado por instalar.py\n", encoding="utf-8")
    register_uninstall()


def uninstall():
    from tkinter import Tk, messagebox
    Tk().withdraw()
    title = "Desinstalação do TV Browser"
    if not MARKER.is_file():
        # sem a marca, esta é a pasta do projeto (ou uma cópia solta): apagar a pasta seria apagar o código
        return messagebox.showerror(title, "Esta pasta não corresponde a uma instalação do TV Browser.")
    if not messagebox.askyesno(title, "Deseja desinstalar o TV Browser deste computador?"):
        return
    shortcuts(False)
    in_steam = not steam.uninstall()
    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY)
    except OSError:
        pass
    profile = tvbrowser.data_dir() / "perfil"
    if profile.is_dir() and messagebox.askyesno(title, "Deseja remover também os dados de navegação (contas conectadas e sites salvos)?"):
        shutil.rmtree(profile, ignore_errors=True)
    messagebox.showinfo(title, "O TV Browser foi desinstalado." + (
        "\n\nO Steam está em execução, portanto o atalho da biblioteca foi mantido. "
        "Para removê-lo, use Gerenciar > Remover jogo não Steam." if in_steam else ""))
    # a pasta não se apaga com o Python dela rodando: um cmd solto espera a gente sair e apaga
    subprocess.Popen(f'cmd /c ping -n 3 127.0.0.1 >nul & rmdir /s /q "{ROOT}"', cwd=os.environ["TEMP"],
                     creationflags=HIDDEN | subprocess.DETACHED_PROCESS)


def window():
    import ctypes
    import tkinter as tk
    from tkinter import ttk

    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)  # sem isso o Windows amplia a janela e o texto sai borrado
    except (AttributeError, OSError):
        pass
    root = tk.Tk()
    scale = root.winfo_fpixels("1i") / 96
    px = lambda value: round(value * scale)  # medidas em pixel acompanham a escala do Windows

    root.title("Instalação do TV Browser")
    root.configure(bg=BG)
    root.resizable(False, False)
    try:
        root.iconbitmap(ROOT / "assets" / "icon.ico")
    except tk.TclError:
        pass

    def label(parent, text, size=10, color=TEXT, bold=False, **options):
        return tk.Label(parent, text=text, bg=parent["bg"], fg=color, font=(FONT_BOLD if bold else FONT, size), **options)

    def button(parent, text, primary, command):
        colors = (ACCENT, INK, ACCENT_HOVER) if primary else ("#242a24", TEXT, "#2f372f")
        widget = tk.Button(parent, text=text, command=command, bg=colors[0], fg=colors[1], activebackground=colors[2],
                           activeforeground=colors[1], disabledforeground=DISABLED, relief="flat", bd=0, cursor="hand2",
                           font=(FONT_BOLD, 10), padx=px(22), pady=px(7))
        # desligado, o botão perde a cor: um botão verde-limão que não responde parece travado
        widget.enable = lambda on: widget.config(state="normal" if on else "disabled", bg=colors[0] if on else "#1c211c",
                                                 cursor="hand2" if on else "")
        widget.bind("<Enter>", lambda _: widget["state"] == "normal" and widget.config(bg=colors[2]))
        widget.bind("<Leave>", lambda _: widget["state"] == "normal" and widget.config(bg=colors[0]))
        return widget

    locked = [False]  # durante a instalação as opções não mudam

    def option(parent, title, detail, checked, enabled):
        """Cartão com caixa de seleção desenhada (a nativa do tkinter destoa do resto)."""
        chosen = tk.BooleanVar(value=checked and enabled)
        frame = tk.Frame(parent, bg=PANEL, highlightthickness=1, highlightbackground=BORDER, padx=px(14), pady=px(12),
                         cursor="hand2" if enabled else "")
        frame.pack(fill="x", pady=px(4))
        box = tk.Canvas(frame, width=px(18), height=px(18), bg=PANEL, highlightthickness=0)
        box.pack(side="left", anchor="n", pady=px(3))
        text = tk.Frame(frame, bg=PANEL)
        text.pack(side="left", fill="x", expand=True, padx=(px(12), 0))
        label(text, title, 11, TEXT if enabled else DISABLED, bold=True).pack(anchor="w")
        label(text, detail, 9, MUTED if enabled else DISABLED, wraplength=px(430), justify="left").pack(anchor="w")

        def draw():
            on, side = chosen.get(), px(18)
            box.delete("all")
            box.create_rectangle(1, 1, side - 1, side - 1, fill=ACCENT if on else PANEL, outline=ACCENT if on else BORDER_STRONG)
            if on:
                box.create_line(px(4), px(9), px(8), px(13), px(14), px(5), fill=INK, width=px(2), capstyle="round", joinstyle="round")
            frame.config(highlightbackground=BORDER_STRONG if on else BORDER)

        def toggle(_):
            if enabled and not locked[0]:
                chosen.set(not chosen.get())
                draw()

        for widget in (frame, box, text, *text.winfo_children()):
            widget.bind("<Button-1>", toggle)
        draw()
        return chosen

    # cabeçalho
    header = tk.Frame(root, bg=HEADER, padx=px(28), pady=px(18))
    header.pack(fill="x")
    logo = tk.PhotoImage(file=ROOT / "assets" / "icon.png")
    root.logo = logo = logo.subsample(max(1, round(logo.width() / px(52))))  # root.logo: a imagem some se ninguém a segura
    tk.Label(header, image=logo, bg=HEADER).pack(side="left")
    titles = tk.Frame(header, bg=HEADER)
    titles.pack(side="left", padx=px(16))
    label(titles, "TV Browser", 17, bold=True).pack(anchor="w")
    label(titles, "Assistente de instalação", 10, MUTED).pack(anchor="w")
    tk.Frame(root, bg=BORDER, height=1).pack(fill="x")

    # opções
    body = tk.Frame(root, bg=BG, padx=px(28), pady=px(22))
    body.pack(fill="both")
    label(body, "Tipo de instalação", 12, bold=True).pack(anchor="w")
    label(body, "Selecione como o TV Browser será disponibilizado neste computador.", 9, MUTED).pack(anchor="w", pady=(px(2), px(12)))
    has_steam = steam.find_steam() is not None
    standalone = option(body, "Aplicativo independente", "Cria atalhos na Área de Trabalho e no Menu Iniciar.", True, True)
    in_steam = option(body, "Integração com o Steam",
                      "Adiciona o TV Browser à biblioteca do Steam, com arte própria, para uso no modo Big Picture."
                      if has_steam else "O Steam não foi encontrado neste computador.", True, has_steam)

    # detalhes (antes) e andamento (durante): ocupam o mesmo lugar
    stage = tk.Frame(body, bg=BG, height=px(92))  # cabe pasta de destino em duas linhas (nome de usuário comprido)
    stage.pack(fill="x", pady=(px(16), 0))
    stage.pack_propagate(False)
    details = tk.Frame(stage, bg=BG)
    details.pack(fill="x")
    for name, value in (("Pasta de destino", str(ROOT)),
                        ("Componente necessário", "Mozilla Firefox (já instalado)" if has_firefox()
                         else "Mozilla Firefox (download automático)")):
        row = tk.Frame(details, bg=BG)
        row.pack(fill="x", pady=px(2))
        label(row, name, 9, MUTED, width=22, anchor="w").pack(side="left")
        label(row, value, 9, TEXT, wraplength=px(360), justify="left", anchor="w").pack(side="left", fill="x")

    progress = tk.Frame(stage, bg=BG)
    style = ttk.Style(root)
    style.theme_use("clam")
    style.configure("TVB.Horizontal.TProgressbar", troughcolor=PANEL, background=ACCENT, bordercolor=BORDER,
                    lightcolor=ACCENT, darkcolor=ACCENT, thickness=px(6))
    bar = ttk.Progressbar(progress, style="TVB.Horizontal.TProgressbar", maximum=1.0)
    bar.pack(fill="x", pady=(px(6), px(8)))
    status = label(progress, "", 9, MUTED, wraplength=px(500), justify="left", anchor="w")
    status.pack(fill="x")

    # rodapé
    tk.Frame(root, bg=BORDER, height=1).pack(fill="x")
    footer = tk.Frame(root, bg=HEADER, padx=px(28), pady=px(14))
    footer.pack(fill="x")
    open_after = tk.BooleanVar(value=True)
    open_box = tk.Checkbutton(footer, text="Abrir o TV Browser ao concluir", variable=open_after, bg=HEADER, fg=TEXT, selectcolor=PANEL,
                              activebackground=HEADER, activeforeground=TEXT, font=(FONT, 9), bd=0, highlightthickness=0)

    messages = queue.Queue()  # o trabalho roda em outra thread; só esta aqui mexe na janela

    def work():
        try:
            install(standalone.get(), in_steam.get(), lambda text, part=None: messages.put(("status", text, part)))
            messages.put(("done", None, None))
        except Exception as error:
            messages.put(("failed", str(error), None))

    def start():
        locked[0] = True
        details.pack_forget()
        progress.pack(fill="x")
        status.config(text="Preparando a instalação...", fg=MUTED)
        bar.config(value=0)
        primary.config(text="Instalando...")
        primary.enable(False)
        cancel.enable(False)
        threading.Thread(target=work, daemon=True).start()

    def finish():
        if open_after.get():
            subprocess.Popen([str(PYTHONW), str(ROOT / "tvbrowser.py")], cwd=ROOT)
        root.destroy()

    def pump():
        while not messages.empty():
            kind, text, part = messages.get()
            if kind == "status":
                status.config(text=text, fg=MUTED)
                if part is not None:
                    bar.config(value=part)
            elif kind == "done":
                bar.config(value=1)
                status.config(text="Instalação concluída.", fg=TEXT)
                cancel.pack_forget()
                open_box.pack(side="left")
                primary.config(text="Concluir", command=finish)
                primary.enable(True)
            else:
                locked[0] = False
                status.config(text=text, fg=ERROR)
                primary.config(text="Tentar novamente")
                primary.enable(True)
                cancel.enable(True)
        root.after(100, pump)

    primary = button(footer, "Instalar", True, start)
    primary.pack(side="right")
    cancel = button(footer, "Cancelar", False, root.destroy)
    cancel.pack(side="right", padx=px(10))

    root.update_idletasks()
    width, height = px(560), root.winfo_reqheight()
    root.geometry(f"{width}x{height}+{(root.winfo_screenwidth() - width) // 2}+{(root.winfo_screenheight() - height) // 3}")
    pump()
    return root


if __name__ == "__main__":
    if "--uninstall" in sys.argv:
        uninstall()
    else:
        window().mainloop()
