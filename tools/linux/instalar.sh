#!/bin/sh
# Instalador do TV Browser para Linux, num arquivo só: este script e, colado depois da linha
# __PAYLOAD__, o pacote com os arquivos (quem cola é tools/build_installer.py).
#
#   sh TVBrowser-linux.run
#
# Não pede root: tudo vai para ~/.local/share/tvbrowser. As perguntas saem em janela (kdialog ou
# zenity) ou, sem nenhuma das duas, no terminal. Para instalar sem perguntas: TVB_ATALHO=0/1 e
# TVB_STEAM=0/1 no ambiente.
set -eu

APP="${XDG_DATA_HOME:-$HOME/.local/share}/tvbrowser/app"
MENU="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
TITLE="TV Browser"
GRAPHICAL="${DISPLAY:-}${WAYLAND_DISPLAY:-}"

have() { command -v "$1" >/dev/null 2>&1; }

# ask VARIAVEL "pergunta": responde 0 (sim) ou 1 (não). A variável de ambiente, se definida, decide.
ask() {
    eval "preset=\${$1:-}"
    case "$preset" in 0) return 1 ;; 1) return 0 ;; esac
    if [ -n "$GRAPHICAL" ] && have kdialog; then kdialog --title "$TITLE" --yesno "$2"
    elif [ -n "$GRAPHICAL" ] && have zenity; then zenity --question --title="$TITLE" --text="$2"
    elif [ -t 0 ]; then
        printf '%s [S/n] ' "$2"
        read -r answer
        case "$answer" in n* | N*) return 1 ;; esac
    fi
}

tell() {
    echo "$1"
    if [ -n "$GRAPHICAL" ] && have kdialog; then kdialog --title "$TITLE" --msgbox "$1"
    elif [ -n "$GRAPHICAL" ] && have zenity; then zenity --info --title="$TITLE" --text="$1"
    fi
}

fail() {
    tell "$1"
    exit 1
}

PYTHON="$(command -v python3 || command -v python || true)"
[ -n "$PYTHON" ] || fail "O TV Browser precisa do Python 3, que não achei neste sistema."

echo "Copiando o TV Browser para $APP ..."
mkdir -p "$APP"
start="$(awk '/^__PAYLOAD__$/ { print NR + 1; exit }' "$0")"
tail -n +"$start" "$0" | tar -xz -C "$APP"
chmod +x "$APP/tvbrowser.sh" "$APP/desinstalar.sh"

# Sem Firefox nenhum (nem do sistema, nem Flatpak): baixa o oficial da Mozilla para dentro da pasta
# do TV Browser. É só desempacotar: não instala nada no sistema.
if [ "$(cd "$APP" && "$PYTHON" -c 'import tvbrowser, pathlib; print(bool(tvbrowser.find_firefox(pathlib.Path("."))))')" != "True" ]; then
    case "$(uname -m)" in
        x86_64) os=linux64 ;;
        aarch64) os=linux64-aarch64 ;;
        *) fail "Não achei o Firefox e não sei baixá-lo para este processador ($(uname -m)). Instale o Firefox e rode de novo." ;;
    esac
    url="https://download.mozilla.org/?product=firefox-latest-ssl&os=$os&lang=pt-BR"
    package="$APP/firefox-download"
    echo "Baixando o Firefox da Mozilla (uns 90 MB) ..."
    if have curl; then curl -L --fail -o "$package" "$url"
    elif have wget; then wget -O "$package" "$url"
    else "$PYTHON" -c 'import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])' "$url" "$package"
    fi || fail "Não consegui baixar o Firefox. Confira a internet e rode de novo."
    tar -xf "$package" -C "$APP" || fail "Não consegui desempacotar o Firefox baixado."
    rm -f "$package"
    [ -x "$APP/firefox/firefox" ] || fail "O Firefox não ficou onde eu esperava."
fi

if ask TVB_ATALHO "Criar o atalho do TV Browser no menu de aplicativos? (modo TV sozinho)"; then
    mkdir -p "$MENU"
    cat >"$MENU/tvbrowser.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=TV Browser
Comment=Netflix, YouTube e companhia na TV, pelo controle
Exec="$APP/tvbrowser.sh"
Icon=$APP/assets/icon.png
Terminal=false
Categories=AudioVideo;Network;
EOF
fi

if ask TVB_STEAM "Pôr o TV Browser na biblioteca do Steam, com capa? (abre pelo Big Picture / modo jogo)"; then
    # o Steam regrava os atalhos ao fechar: só dá pra gravar com ele fechado
    while pgrep -x steam >/dev/null 2>&1; do
        tell "O Steam está aberto. Feche-o (Steam > Sair) e confirme aqui para continuar."
        sleep 2
    done
    "$PYTHON" "$APP/tvbrowser.py" --steam || tell "Não consegui pôr no Steam. O resto foi instalado."
fi

tell "TV Browser instalado. Para tirar depois: $APP/desinstalar.sh"
exit 0
__PAYLOAD__
