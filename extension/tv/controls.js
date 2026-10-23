// Tela "Controles" (menu do Start): o guia do que cada botão faz e o teste do controle.
TV.controls = (() => {
  // [seção, [[botões, o que faz, separador entre os botões], ...]]
  const GUIDE = [
    ['Navegação', [
      [['dpad'], 'Mover o foco entre os itens da página'],
      [['lstick'], 'Mover o ponteiro'],
      [['select'], 'Selecionar o item em foco ou clicar com o ponteiro'],
      [['back'], 'Voltar'],
      [['keyboard'], 'Buscar no site'],
      [['rstick'], 'Rolar a página'],
      [['pageup', 'pagedown'], 'Rolar uma tela para cima ou para baixo'],
    ]],
    ['Vídeo', [
      [['media'], 'Reproduzir ou pausar'],
      [['rewind', 'forward'], 'Voltar ou avançar 10 segundos'],
      [['menu', 'home'], 'Picture-in-picture: o vídeo passa para uma janela flutuante', '+'],
    ]],
    ['Sistema', [
      [['menu'], 'Abrir o menu'],
      [['home'], 'Segurar: ir para a tela inicial'],
    ]],
  ];
  // Peças do desenho do controle: [nome no retrato de TV.input.snapshot, botão cujo nome aparece nela]
  const PARTS = [
    ['lt', 'rewind'], ['rt', 'forward'], ['lb', 'pageup'], ['rb', 'pagedown'],
    ['up'], ['down'], ['left'], ['right'], ['view'], ['guide'], ['menu'],
    ['y', 'keyboard'], ['x', 'media'], ['b', 'back'], ['a', 'select'],
  ];
  const HOLD = 800; // ms segurando B para sair do teste (um toque só tem que acender o B, não fechar)

  let panel = null, body = null, foot = null, tabs = [];
  let tab = 0, isOpen = false, parts = {}, heldSince = 0;

  const el = (...args) => TV.ui.el(...args);

  function guide() {
    const view = el('div', 'ctl-guide');
    for (const [title, rows] of GUIDE) {
      const section = el('section');
      section.append(el('h3', '', title));
      for (const [actions, text, joiner] of rows) {
        const row = el('div', 'ctl-row');
        const keys = el('span', 'ctl-keys');
        actions.forEach((action, index) => {
          if (index && joiner) keys.append(el('i', '', joiner));
          keys.append(TV.pad.badge(action));
        });
        row.append(keys, el('span', '', text));
        section.append(row);
      }
      view.append(section);
    }
    const style = el('div', 'ctl-style');
    style.append(el('span', 'ctl-muted', 'Símbolos dos botões'), el('strong', '', TV.pad.describe()));
    view.append(style);
    return view;
  }

  function tester() {
    const view = el('div', 'ctl-test');
    const diagram = el('div', 'diagram');
    diagram.append(el('div', 'p-body'));
    parts = {};
    for (const [key, action] of PARTS) {
      parts[key] = el('div', `part p-${key}`, action ? TV.pad.label(action) : '');
      diagram.append(parts[key]);
    }
    for (const side of ['l', 'r']) {
      const stick = el('div', `stick p-${side}s`);
      parts[`${side}3`] = el('div', 'knob');
      stick.append(parts[`${side}3`]);
      diagram.append(stick);
    }
    const info = el('div', 'ctl-info');
    parts.name = el('strong', '', '');
    parts.kind = el('span', 'ctl-muted', '');
    info.append(parts.name, parts.kind);
    view.append(diagram, info);
    return view;
  }

  function render() {
    tabs.forEach((button, index) => button.classList.toggle('sel', index === tab));
    body.replaceChildren(tab === 0 ? guide() : tester());
    foot.replaceChildren(tab === 0
      ? TV.pad.hints([[['pageup', 'pagedown'], 'Trocar de aba'], [['select'], 'Trocar os símbolos'], [['back'], 'Voltar']])
      : TV.pad.hints([[['back'], 'Segure para voltar']]));
  }

  // Chamado a cada quadro: no teste, acende as peças do desenho conforme o controle.
  function tick(now) {
    if (!isOpen || tab !== 1) return;
    const pad = TV.input.snapshot();
    parts.name.textContent = pad ? pad.id.replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '').replace(/^xinput$/i, 'Controle Xbox') : 'Nenhum controle detectado';
    parts.kind.textContent = !pad ? 'Pressione qualquer botão do controle.'
      : pad.standard ? 'Controle reconhecido.' : 'Controle genérico: só os botões com função no TV Browser aparecem aqui.';
    for (const [key] of PARTS) parts[key].classList.toggle('on', Boolean(pad && pad.pressed.has(key)));
    for (const side of ['l', 'r']) {
      const knob = parts[`${side}3`];
      knob.classList.toggle('on', Boolean(pad && pad.pressed.has(`${side}3`)));
      knob.style.transform = pad ? `translate(${pad[`${side}x`] * 0.9}em, ${pad[`${side}y`] * 0.9}em)` : '';
    }
    for (const side of ['lt', 'rt']) parts[side].style.setProperty('--fill', pad ? pad[side] : 0);

    // B segurado sai do teste
    if (pad && pad.pressed.has('b')) {
      heldSince = heldSince || now;
      if (now - heldSince > HOLD) show(0);
    } else {
      heldSince = 0;
    }
  }

  function show(index) {
    tab = index;
    heldSince = 0;
    render();
    TV.sfx('move');
  }

  function open() {
    const root = TV.ui.mount();
    if (!panel) {
      panel = el('div', 'panel controls');
      const head = el('div', 'ctl-head');
      head.append(el('div', 'menu-title', 'Controles'));
      tabs = ['Guia', 'Testar controle'].map((name, index) => {
        const button = el('button', 'tab', name);
        button.addEventListener('click', () => show(index));
        head.append(button);
        return button;
      });
      body = el('div', 'ctl-body');
      foot = el('div', 'ctl-foot');
      panel.append(head, body, foot);
      TV.pad.onChange(() => isOpen && render());
    }
    root.append(panel);
    isOpen = true;
    tab = 0;
    render();
    TV.sfx('open');
  }

  function close() {
    if (panel) panel.remove();
    isOpen = false;
    TV.sfx('close');
  }

  function action(a, source) {
    if (tab === 1) {
      // no teste o controle só acende o desenho; pelo teclado, Esc volta na hora
      if (source === 'keyboard' && a === 'back') show(0);
      return;
    }
    if (a === 'pageup' || a === 'pagedown' || a === 'left' || a === 'right') show(1);
    else if (a === 'select') TV.pad.cycle();
    else if (a === 'back' || a === 'menu') close();
  }

  return { open, close, action, tick, isOpen: () => isOpen };
})();
