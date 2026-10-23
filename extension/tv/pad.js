// Nomes dos botões conforme o controle na mão: Xbox (A B X Y) ou PlayStation (✕ ○ □ △).
// Tudo que mostra um botão na tela (dicas do menu, do teclado, da tela inicial, o guia) passa por aqui.
TV.pad = (() => {
  const LABELS = {
    xbox: {
      select: 'A', back: 'B', media: 'X', keyboard: 'Y', pageup: 'LB', pagedown: 'RB', rewind: 'LT', forward: 'RT',
      menu: 'Start', home: 'Select', dpad: '✚', lstick: 'L', rstick: 'R',
    },
    playstation: {
      select: '✕', back: '○', media: '◻', keyboard: '△', pageup: 'L1', pagedown: 'R1', rewind: 'L2', forward: 'R2',
      menu: 'Options', home: 'Share', dpad: '✚', lstick: 'L', rstick: 'R',
    },
  };
  const NAMES = { auto: 'Automático', xbox: 'Xbox', playstation: 'PlayStation' };
  const NEXT = { auto: 'xbox', xbox: 'playstation', playstation: 'auto' };

  let choice = 'auto';   // o que a pessoa escolheu em Controles
  let detected = 'xbox'; // o que o controle ligado diz ser
  const listeners = [];

  const style = () => (choice === 'auto' ? detected : choice);
  const label = (action) => LABELS[style()][action];
  const changed = () => listeners.forEach((listener) => listener());

  function badge(action) {
    const text = label(action);
    return TV.ui.el('span', text.length > 1 ? 'badge wide' : 'badge', text);
  }

  // Linha de dicas: [[ações, texto], ...]; mais de uma ação no mesmo item mostra os botões lado a lado.
  function hints(items) {
    const row = TV.ui.el('div', 'hints');
    for (const [actions, text] of items) {
      const item = TV.ui.el('span');
      for (const action of [].concat(actions)) item.append(badge(action));
      item.append(text);
      row.append(item);
    }
    return row;
  }

  // Chamado pela leitura do controle. Pelo Steam Input um DualSense chega como controle de Xbox:
  // aí não há como saber, e a escolha manual resolve.
  function seen(id) {
    const now = /054c|dualsense|dualshock|playstation/i.test(id) ? 'playstation' : 'xbox';
    if (now === detected) return;
    detected = now;
    changed();
  }

  function cycle() {
    choice = NEXT[choice];
    if (TV.api) TV.api.storage.local.set({ padStyle: choice });
    changed();
  }

  if (TV.api) {
    TV.api.storage.local.get('padStyle').then((stored) => {
      if (!LABELS[stored.padStyle] || stored.padStyle === choice) return;
      choice = stored.padStyle;
      changed();
    });
    TV.api.storage.onChanged.addListener((changes) => {
      const value = changes.padStyle && changes.padStyle.newValue;
      if (!value || value === choice || !NAMES[value]) return;
      choice = value;
      changed();
    });
  }

  return {
    label, badge, hints, seen, cycle,
    onChange: (listener) => listeners.push(listener),
    describe: () => (choice === 'auto' ? `Automático (${NAMES[detected]})` : NAMES[choice]),
  };
})();
