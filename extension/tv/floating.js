// Tela "Janela flutuante" (menu do Start): onde na tela e de que tamanho o picture-in-picture abre.
// O que fica guardado é { col, row, width }; quem posiciona a janela de verdade é o lançador (pipmode.py).
TV.floating = (() => {
  const WIDTHS = [0.2, 0.25, 0.33, 0.4, 0.5]; // fração da largura da tela
  const COLS = ['à esquerda', 'no centro', 'à direita'];
  const ROWS = ['Em cima', 'No meio', 'Embaixo'];
  const GAP = 3; // margem até a borda, em % (a mesma proporção que o lançador usa)

  let panel = null, box = null, status = null, hints = null, isOpen = false;
  let place = { col: 2, row: 2, width: 0.33 };

  const along = (index, size) => [GAP, (100 - size) / 2, 100 - size - GAP][index];

  function draw() {
    // a miniatura da tela tem a proporção do vídeo (16:9), então largura e altura dão a mesma porcentagem
    const size = place.width * 100;
    box.style.width = box.style.height = `${size}%`;
    box.style.left = `${along(place.col, size)}%`;
    box.style.top = `${along(place.row, size)}%`;
    status.textContent = `${ROWS[place.row]}, ${COLS[place.col]} · ${Math.round(size)}% da largura da tela`;
  }

  function change(patch) {
    place = { ...place, ...patch };
    if (TV.api) TV.api.storage.local.set({ floating: place });
    draw();
    TV.sfx('move');
  }

  function resize(step) {
    const index = WIDTHS.indexOf(place.width) + step;
    if (WIDTHS[index]) change({ width: WIDTHS[index] });
  }

  function open() {
    const root = TV.ui.mount();
    if (!panel) {
      const el = TV.ui.el;
      panel = el('div', 'panel floating');
      const screen = el('div', 'fl-screen');
      box = el('div', 'fl-box', 'Vídeo');
      screen.append(box);
      status = el('div', 'fl-status');
      hints = el('div');
      panel.append(el('div', 'menu-title', 'Janela flutuante'), el('div', 'ctl-muted', 'Onde o vídeo fica ao apertar os dois botões do picture-in-picture.'),
        screen, status, hints);
    }
    hints.replaceChildren(TV.pad.hints([[['dpad'], 'Posição'], [['pageup', 'pagedown'], 'Tamanho'], [['back'], 'Voltar']]));
    root.append(panel);
    isOpen = true;
    draw();
    TV.sfx('open');
    if (TV.api) {
      TV.api.storage.local.get('floating').then((stored) => {
        if (stored.floating) place = { ...place, ...stored.floating };
        draw();
      });
    }
  }

  function close() {
    if (panel) panel.remove();
    isOpen = false;
    TV.sfx('close');
  }

  function action(a) {
    if (a === 'left' && place.col > 0) change({ col: place.col - 1 });
    else if (a === 'right' && place.col < 2) change({ col: place.col + 1 });
    else if (a === 'up' && place.row > 0) change({ row: place.row - 1 });
    else if (a === 'down' && place.row < 2) change({ row: place.row + 1 });
    else if (a === 'pageup') resize(-1);
    else if (a === 'pagedown') resize(1);
    else if (a === 'back' || a === 'menu' || a === 'select') close();
  }

  return { open, close, action, isOpen: () => isOpen };
})();
