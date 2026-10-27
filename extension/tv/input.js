// Entrada: transforma controle e teclado nas mesmas "ações" (up, select, back...).
// O Steam Input pode mandar tanto um controle de verdade quanto setas/Enter/Esc: os dois caminhos funcionam.
TV.input = (() => {
  const DELAY = 380;  // ms segurando até começar a repetir
  const RATE = 100;   // ms entre repetições
  const DEADZONE = 0.2;
  const REPEATABLE = new Set(['up', 'down', 'left', 'right', 'pageup', 'pagedown', 'rewind', 'forward']);

  // Mapeamento "standard" da Gamepad API (layout Xbox).
  const STANDARD = {
    0: 'select', 1: 'back', 2: 'media', 3: 'keyboard',
    4: 'pageup', 5: 'pagedown', 6: 'rewind', 7: 'forward',
    8: 'home', 9: 'menu',
    12: 'up', 13: 'down', 14: 'left', 15: 'right',
  };
  // Controle que o Firefox não reconhece chega sem mapeamento padrão: os botões vêm na ordem do
  // próprio aparelho. Este é o padrão de quem não tem perfil abaixo (ordem do driver xpad do Linux).
  const GENERIC = {
    buttons: { 0: 'select', 1: 'back', 2: 'media', 3: 'keyboard', 4: 'pageup', 5: 'pagedown', 6: 'home', 7: 'menu' },
  };
  // Perfis por aparelho, pelo começo do id que o Firefox dá ("vendedor-produto-nome").
  const PROFILES = [
    {
      // Celular Samsung como controle Bluetooth (BridgePad): A B X Y LB RB Start Select,
      // analógico direito nos eixos 3/4 e gatilhos nos eixos 2/5.
      id: /^0075-0100/i,
      buttons: { 0: 'select', 1: 'back', 2: 'media', 3: 'keyboard', 4: 'pageup', 5: 'pagedown', 6: 'menu', 7: 'home' },
      triggers: { 2: 'rewind', 5: 'forward' },
      scroll: [3, 4],
    },
  ];
  const HAT = ['up', null, 'right', null, 'down', null, 'left', null]; // diagonais não movem nada

  // O Steam Input repete o controle de verdade num controle virtual da Valve (28de:11ff), já com o
  // mapeamento escolhido no Steam. O Firefox enxerga os dois, e cada aperto contava duas vezes (no
  // Modo Jogo do Bazzite o foco pulava de dois em dois). Havendo o virtual, só ele vale.
  const STEAM_VIRTUAL = /^28de-11ff-/i;
  function connectedPads() {
    try { return [...navigator.getGamepads()].filter((p) => p && p.connected); } catch { return []; }
  }
  function usablePads(pads = connectedPads()) {
    const steam = pads.filter((p) => STEAM_VIRTUAL.test(p.id));
    return steam.length ? steam : pads;
  }

  const held = new Map(); // "indice:ação" -> quando repetir
  // Start + Select juntos = picture-in-picture. Por isso esses dois não agem ao apertar: o Start
  // abre o menu ao soltar, e o Select só leva à tela inicial se ficar segurado. Um toque no Select,
  // que é o que acontece quando o aperto dos dois sai torto, não pode fechar o que se está assistindo.
  const CHORD = ['menu', 'home'];
  const HOME_HOLD = 700; // ms
  const waiting = new Map(); // "indice:ação" de Start/Select apertado e ainda sem destino -> desde quando
  let onAction = () => {};
  let onScroll = () => {};
  let onPointer = () => {};

  function isDown(button) {
    return button !== undefined && (typeof button === 'object' ? button.pressed || button.value > 0.5 : button > 0.5);
  }

  // Gatilho (LT/RT no mapeamento padrão) só conta apertado de verdade. O controle do Xbox por
  // Bluetooth no Linux chega com os gatilhos soltos em ~0,5 e `pressed` ligado (visto no Bazzite):
  // no vídeo era voltar e avançar 10 s sem parar, e não dava pra pausar.
  const TRIGGERS = new Set(['6', '7']);
  function triggerDown(button) {
    return button !== undefined && (typeof button === 'object' ? button.value : button) > 0.75;
  }

  function profileOf(pad) {
    return PROFILES.find((p) => p.id.test(pad.id)) || GENERIC;
  }

  // Direcional de controle sem mapeamento padrão.
  function genericDpad(pad, out) {
    const axes = pad.axes;
    // Firefox no Windows (conferido com o BridgePad): o direcional é o eixo 9, em oito passos de
    // -1 (cima) a 1 no sentido horário; solto, fica fora da faixa (1,29). Só vale valor exato de
    // um passo, pra um eixo 9 que seja outra coisa (parado em 0) não virar "baixo" preso.
    if (axes.length >= 10) {
      const step = (axes[9] + 1) * 3.5;
      const dir = Math.abs(step - Math.round(step)) < 0.1 ? HAT[Math.round(step)] : null;
      if (dir) out.add(dir);
    }
    // Driver xpad do Linux: direcional nos eixos 6 e 7.
    if (axes.length >= 8) {
      if (axes[6] < -0.5) out.add('left');
      if (axes[6] > 0.5) out.add('right');
      if (axes[7] < -0.5) out.add('up');
      if (axes[7] > 0.5) out.add('down');
    }
  }

  function actionsOf(pad) {
    const standard = pad.mapping === 'standard';
    const profile = standard ? null : profileOf(pad);
    const map = standard ? STANDARD : profile.buttons;
    const out = new Set();
    for (const index in map) {
      const down = standard && TRIGGERS.has(index) ? triggerDown : isDown;
      if (down(pad.buttons[index])) out.add(map[index]);
    }
    if (!standard) {
      genericDpad(pad, out);
      // gatilho em eixo: solto fica em -1, apertado vai a +1
      for (const axis in profile.triggers) {
        if (pad.axes[axis] > 0.5) out.add(profile.triggers[axis]);
      }
    }
    return out;
  }

  // Retrato do primeiro controle ligado, para o teste em Controles: quais botões estão apertados
  // (pelo nome do layout Xbox) e onde estão os analógicos e gatilhos.
  const STANDARD_KEYS = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'view', 'menu', 'l3', 'r3', 'up', 'down', 'left', 'right', 'guide'];
  const ACTION_KEYS = {
    select: 'a', back: 'b', media: 'x', keyboard: 'y', pageup: 'lb', pagedown: 'rb', rewind: 'lt', forward: 'rt',
    menu: 'menu', home: 'view', up: 'up', down: 'down', left: 'left', right: 'right',
  };
  function snapshot() {
    const [pad] = usablePads();
    if (!pad) return null;
    const standard = pad.mapping === 'standard';
    const pressed = new Set();
    if (standard) STANDARD_KEYS.forEach((key, index) => (TRIGGERS.has(String(index)) ? triggerDown : isDown)(pad.buttons[index]) && pressed.add(key));
    else for (const action of actionsOf(pad)) if (ACTION_KEYS[action]) pressed.add(ACTION_KEYS[action]);
    const right = standard ? [2, 3] : profileOf(pad).scroll || [];
    const amount = (index, key) => (standard ? (pad.buttons[index] || {}).value || 0 : Number(pressed.has(key)));
    return {
      id: pad.id, standard, pressed,
      lx: pad.axes[0] || 0, ly: pad.axes[1] || 0, rx: pad.axes[right[0]] || 0, ry: pad.axes[right[1]] || 0,
      lt: amount(6, 'lt'), rt: amount(7, 'rt'),
    };
  }

  // Zona morta do analógico, com o resto do curso reescalado para 0..1.
  function dead(value) {
    const size = Math.abs(value || 0);
    return size < DEADZONE ? 0 : (Math.sign(value) * (size - DEADZONE)) / (1 - DEADZONE);
  }

  let lastPoll = 0;
  function poll(now) {
    const dt = Math.min(50, now - lastPoll);
    lastPoll = now;
    // Só com a nossa janela em uso. Com o picture-in-picture aberto o Firefox mantém a página
    // "visível" mesmo minimizada, e sem conferir o foco o TV Browser seguia obedecendo ao controle
    // enquanto a pessoa navegava no Steam ou jogava.
    if (document.hidden || !document.hasFocus()) return;
    const pads = connectedPads();
    if (pads.length) TV.pad.seen(pads.map((pad) => pad.id));
    const seen = new Set();
    for (const pad of usablePads(pads)) {
      const actions = actionsOf(pad);
      for (const action of actions) {
        const key = `${pad.index}:${action}`;
        seen.add(key);
        const next = held.get(key);
        if (CHORD.includes(action)) {
          if (next === undefined) {
            held.set(key, Infinity);
            waiting.set(key, now);
          } else if (action === 'home' && now - waiting.get(key) >= HOME_HOLD) {
            waiting.delete(key);
            onAction('home', 'gamepad');
          }
        } else if (next === undefined) {
          held.set(key, now + DELAY);
          onAction(action, 'gamepad');
        } else if (REPEATABLE.has(action) && now >= next) {
          held.set(key, now + RATE);
          onAction(action, 'gamepad');
        }
      }
      const chord = CHORD.map((action) => `${pad.index}:${action}`);
      if (chord.every((key) => waiting.has(key))) {
        chord.forEach((key) => waiting.delete(key));
        onAction('pip', 'gamepad');
      }
      // analógico esquerdo = ponteiro, direito = rolagem
      const px = dead(pad.axes[0]), py = dead(pad.axes[1]);
      if (px || py) onPointer(px, py, dt);
      const scroll = pad.mapping === 'standard' ? [2, 3] : profileOf(pad).scroll;
      if (scroll) {
        const sx = dead(pad.axes[scroll[0]]), sy = dead(pad.axes[scroll[1]]);
        if (sx || sy) onScroll(sx, sy);
      }
    }
    for (const key of held.keys()) {
      if (seen.has(key)) continue;
      held.delete(key);
      // solto sem ter virado nada: Start abre o menu; Select só avisa que é pra segurar
      if (waiting.delete(key)) onAction(key.endsWith(':menu') ? 'menu' : 'homehint', 'gamepad');
    }
  }

  window.addEventListener('keydown', (event) => {
    // isTrusted: as teclas que nós mesmos fabricamos para o site não podem voltar pra cá.
    if (!event.isTrusted || event.ctrlKey || event.altKey || event.metaKey) return;
    const action = TV.main.keyAction(event);
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    onAction(action, 'keyboard');
  }, true);

  return {
    poll,
    snapshot,
    listen(actionHandler, scrollHandler, pointerHandler) {
      onAction = actionHandler;
      onScroll = scrollHandler;
      onPointer = pointerHandler;
    },
  };
})();
