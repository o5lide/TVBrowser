"""Segura o protetor de tela enquanto o TV Browser toca algo com som (Linux).

No Modo Jogo do Steam quem atende por org.freedesktop.ScreenSaver é o próprio Steam, e é por esse
nome que um programa avisa "estou tocando vídeo". O Firefox do Flatpak não pode falar com ele (a
sandbox só libera o portal, e o pedido pelo portal não chega ao Steam), e o protetor de tela do
Steam aparecia por cima do filme (visto no Bazzite). Então quem avisa é o lançador, que roda fora da
sandbox, olhando de tempos em tempos se alguma aba está com som. No desktop do KDE o nome é do KDE,
e o mesmo aviso segura o bloqueio de tela.

Usa o dbus-python do sistema; sem ele não faz nada, e o resto do TV Browser segue só com a
biblioteca padrão.
"""
import time

NAME = "org.freedesktop.ScreenSaver"
PATHS = ("/org/freedesktop/ScreenSaver", "/ScreenSaver")
CHECK_EVERY = 15  # segundos
SOUND = 'return [...Services.wm.getEnumerator("navigator:browser")].some((win) => win.gBrowser.tabs.some((tab) => tab.soundPlaying));'


class Inhibitor:
    def __init__(self):
        import dbus
        self.dbus = dbus
        self.bus = dbus.SessionBus()  # fica aberta: há quem solte o pedido quando a conexão fecha
        self.cookie = self.target = None

    def hold(self, on):
        if on == (self.cookie is not None):
            return
        if not on:
            try:
                self.target.UnInhibit(self.cookie)
            except self.dbus.DBusException:
                pass
            self.cookie = self.target = None
            return
        for path in PATHS:
            try:
                target = self.dbus.Interface(self.bus.get_object(NAME, path), NAME)
                self.cookie, self.target = target.Inhibit("TV Browser", "Vídeo tocando"), target
                return
            except self.dbus.DBusException:
                continue


def watch(floating, process):
    """Até o Firefox fechar, segura o protetor de tela enquanto houver aba com som.

    `floating`: o pipmode.Pip, que já tem a conexão com o navegador (usada com a trava dele).
    """
    try:
        inhibitor = Inhibitor()
    except Exception:  # sem dbus-python ou sem barramento de sessão
        return
    try:
        while process.poll() is None:
            try:
                with floating.lock:
                    playing = bool(floating.run(SOUND))
            except (OSError, RuntimeError):
                playing = False
            inhibitor.hold(playing)
            for _ in range(CHECK_EVERY * 2):  # sai logo se o Firefox fechar
                if process.poll() is not None:
                    break
                time.sleep(0.5)
    finally:
        inhibitor.hold(False)
