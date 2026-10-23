#!/bin/sh
# Tira o TV Browser instalado por instalar.sh: atalho do menu, entrada no Steam e a pasta do programa.
# Os logins ficam (pasta "perfil", ao lado desta); para apagar também: desinstalar.sh --tudo
set -eu

APP="$(dirname "$(readlink -f "$0")")"
DATA="$(dirname "$APP")"

# só apaga se esta for mesmo a pasta criada pelo instalador (.../tvbrowser/app)
case "$APP" in
    */tvbrowser/app) ;;
    *) echo "Esta pasta não é uma instalação do TV Browser: $APP"; exit 1 ;;
esac

rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/applications/tvbrowser.desktop"

PYTHON="$(command -v python3 || command -v python || true)"
if [ -n "$PYTHON" ] && ! (cd "$APP" && "$PYTHON" -c 'import steam, sys; sys.exit(0 if steam.uninstall() else 1)'); then
    echo "O Steam está aberto, então o atalho de lá ficou: remova por ele (Gerenciar > Remover jogo não Steam)."
fi

rm -rf "$APP"
[ "${1:-}" = "--tudo" ] && rm -rf "$DATA/perfil"
echo "TV Browser desinstalado."
