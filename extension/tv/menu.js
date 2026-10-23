// Menu do Start: o que num navegador comum ficaria na barra de cima.
TV.menu = (() => {
  const ITEMS = [
    ['Início', () => TV.main.goHome()],
    ['Voltar', () => history.back()],
    ['Avançar', () => history.forward()],
    ['Recarregar', () => location.reload()],
    ['Teclado virtual', () => TV.main.openKeyboard()],
    ['Controles', () => TV.controls.open()],
    ['Janela flutuante', () => TV.floating.open()],
    ['Sons', toggleSound],
    ['Sair do TV Browser', () => TV.main.exit()],
  ];
  const SOUND = 7; // posição de "Sons" na lista: o texto dele muda conforme o estado

  let panel = null, buttons = [], hints = null, index = 0, isOpen = false, muted = false;

  function toggleSound() {
    if (!TV.api) return;
    TV.api.storage.local.set({ muted: !muted }).then(() => {
      TV.ui.toast(muted ? 'Sons ativados' : 'Sons desativados');
    });
  }

  function select(i) {
    index = (i + buttons.length) % buttons.length;
    buttons.forEach((b, n) => b.classList.toggle('sel', n === index));
  }

  function run(i) {
    hide();
    TV.sfx('select');
    ITEMS[i][1]();
  }

  function open() {
    const root = TV.ui.mount();
    if (!panel) {
      panel = TV.ui.el('div', 'panel menu');
      panel.append(TV.ui.el('div', 'menu-title', 'TV Browser'));
      buttons = ITEMS.map(([label], i) => {
        const b = TV.ui.el('button', 'item', label);
        b.addEventListener('click', () => run(i));
        panel.append(b);
        return b;
      });
      hints = TV.ui.el('div');
      panel.append(hints);
    }
    // refeitas a cada abertura: os nomes dos botões seguem o controle em uso
    hints.replaceChildren(TV.pad.hints([[['select'], 'Selecionar'], [['back'], 'Fechar']]));
    root.append(panel);
    isOpen = true;
    select(0);
    TV.sfx('open');
    if (TV.api) {
      TV.api.storage.local.get('muted').then((stored) => {
        muted = Boolean(stored.muted);
        buttons[SOUND].textContent = muted ? 'Sons: desativados' : 'Sons: ativados';
      });
    }
  }

  function hide() {
    if (panel) panel.remove();
    isOpen = false;
  }

  function close() {
    hide();
    TV.sfx('close');
  }

  function action(a) {
    if (a === 'up' || a === 'down') {
      select(index + (a === 'up' ? -1 : 1));
      TV.sfx('move');
    } else if (a === 'select') {
      run(index);
    } else if (a === 'back' || a === 'menu') {
      close();
    }
  }

  return { open, close, action, isOpen: () => isOpen };
})();
