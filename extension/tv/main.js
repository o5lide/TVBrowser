// Liga tudo: decide o que cada ação faz conforme o que está na tela (menu, teclado, vídeo, página comum).
TV.main = (() => {
  const site = TV.site;
  const KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Enter: 'select', Escape: 'back', Backspace: 'back', BrowserBack: 'back',
    F1: 'menu', ContextMenu: 'menu', F2: 'home', BrowserHome: 'home', F3: 'pip',
  };
  const KEY_CODES = {
    Enter: [13, 'Enter'], Escape: [27, 'Escape'], ' ': [32, 'Space'],
    ArrowLeft: [37, 'ArrowLeft'], ArrowUp: [38, 'ArrowUp'], ArrowRight: [39, 'ArrowRight'], ArrowDown: [40, 'ArrowDown'],
  };
  const PASSTHROUGH = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', select: 'Enter', back: 'Escape', media: ' ' };
  const DIRECTIONS = new Set(['up', 'down', 'left', 'right']);
  const WORDS = ['search', 'busca', 'pesquis', 'procur'];
  const SEARCH_FIELDS = ['input[type=search]', '[role=searchbox]', 'input[name=q]',
    ...WORDS.flatMap((w) => [`input[name*=${w} i]`, `input[placeholder*=${w} i]`, `input[aria-label*=${w} i]`, `input[id*=${w} i]`])].join(',');
  const SEARCH_OPENERS = WORDS.flatMap((w) => [`button[aria-label*=${w} i]`, `a[aria-label*=${w} i]`, `[role=button][aria-label*=${w} i]`,
    `button[title*=${w} i]`, `a[title*=${w} i]`, `button[data-uia*=${w} i]`, `[data-testid*=${w} i]`, `a[href*="/${w}" i]`, `button[class*=${w} i]`]).join(',');

  // Tecla fabricada, entregue ao site. Devolve false se o site tratou (preventDefault).
  function sendKey(key, target) {
    const [keyCode, code] = KEY_CODES[key];
    const to = target || document.activeElement || document.body;
    const init = { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true };
    const notHandled = to.dispatchEvent(new KeyboardEvent('keydown', init));
    to.dispatchEvent(new KeyboardEvent('keyup', init));
    return notHandled;
  }

  function onScreen(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && (!el.checkVisibility || el.checkVisibility({ visibilityProperty: true, opacityProperty: true }));
  }

  function mainVideo() {
    let best = null, bestArea = 0;
    for (const video of TV.spatial.all('video')) {
      const r = video.getBoundingClientRect();
      if (video.readyState > 0 && r.width * r.height > bestArea) { best = video; bestArea = r.width * r.height; }
    }
    return best;
  }

  // "Palco": um vídeo tomando a tela toda (página de player). Aí esquerda/direita viram voltar/avançar.
  function stage() {
    const video = mainVideo();
    if (!video) return null;
    const r = video.getBoundingClientRect();
    return r.width * r.height >= window.innerWidth * window.innerHeight * 0.85 ? video : null;
  }

  // Botão do próprio player, pelo nome do componente que o guarda (`controls` em tv/base.js).
  // Os controles saem da página quando se escondem: acorda e tenta de novo por meio segundo.
  function pressControl(tag, tries = 6) {
    const button = TV.spatial.all('button').find((b) => (b.getRootNode().host || {}).localName === tag);
    if (button) return button.click();
    if (!tries) return;
    wakeControls();
    setTimeout(() => pressControl(tag, tries - 1), 90);
  }

  const ownControl = (name) => site.controls && stage() && site.controls[name];

  let ownSeekAt = 0;
  function seek(video, seconds) {
    const own = ownControl(seconds < 0 ? 'rewind' : 'forward');
    if (own) {
      // botão segurado repete a cada 100 ms; pro player, 5 cliques por segundo já é bastante
      if (performance.now() - ownSeekAt < 200) return;
      ownSeekAt = performance.now();
      pressControl(own);
    } else if (site.seek === 'keys') sendKey(seconds < 0 ? 'ArrowLeft' : 'ArrowRight');
    else video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + seconds));
    TV.ui.toast(`${seconds < 0 ? '−' : '+'}${Math.abs(seconds)} s`);
  }

  function toggle(video) {
    if (ownControl('toggle')) return pressControl(site.controls.toggle);
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  // Players escondem os controles sem movimento de mouse; isso os traz de volta.
  function wakeControls() {
    const at = TV.spatial.at(window.innerWidth / 2, window.innerHeight / 2);
    if (!at) return;
    const init = { bubbles: true, composed: true, clientX: window.innerWidth / 2 + Math.random() * 4, clientY: window.innerHeight / 2 };
    at.dispatchEvent(new PointerEvent('pointermove', init));
    at.dispatchEvent(new MouseEvent('mousemove', init));
  }

  function activate(el, source) {
    if (TV.osk.isEditable(el)) {
      el.focus();
      if (source === 'gamepad') TV.osk.open(el);
    } else if (el.tagName === 'VIDEO') {
      toggle(el);
    } else if (el.tagName === 'SELECT' && source === 'gamepad') {
      // A lista nativa não abre por script: cada A passa pra próxima opção.
      el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.click();
    }
  }

  function typeInto(field) {
    TV.spatial.focus(field);
    TV.osk.open(field);
  }

  // Item "Teclado" do menu: abre o teclado virtual no primeiro campo de texto que achar.
  function openKeyboard() {
    let field = TV.spatial.current();
    if (!TV.osk.isEditable(field)) field = document.activeElement;
    if (!TV.osk.isEditable(field)) {
      field = TV.spatial.all('input, textarea').find((el) => TV.osk.isEditable(el) && onScreen(el));
    }
    if (field) return typeInto(field);
    TV.sfx('deny');
    TV.ui.toast('Nenhum campo de texto nesta página');
  }

  function searchField() {
    return TV.spatial.all(SEARCH_FIELDS).find((el) => TV.osk.isEditable(el) && onScreen(el));
  }

  // Y: busca do site. Com o foco num campo de texto, é só o teclado nesse campo.
  function search() {
    const focused = TV.spatial.current();
    if (TV.osk.isEditable(focused)) return typeInto(focused);
    if (site.search) {
      return TV.osk.ask(`Buscar em ${location.hostname.replace(/^www\./, '')}`, (text) => {
        if (text.trim()) location.href = site.search.replace('%s', encodeURIComponent(text.trim()));
      });
    }
    const field = searchField();
    if (field) return typeInto(field);
    // Em muito site o campo só aparece depois de clicar na lupa.
    const opener = TV.spatial.all(SEARCH_OPENERS).find(onScreen);
    if (!opener) {
      TV.sfx('deny');
      return TV.ui.toast('Não achei busca neste site');
    }
    opener.click();
    setTimeout(() => {
      const shown = searchField() || (TV.osk.isEditable(document.activeElement) ? document.activeElement : null);
      if (shown) typeInto(shown);
    }, 600);
  }

  // Start + Select: o vídeo vai pra uma janelinha por cima de tudo. A página não pode abrir isso
  // sem um clique de verdade, então quem abre é o lançador (pipmode.py), a pedido do background.
  async function pictureInPicture() {
    if (!TV.api) return;
    if (!mainVideo() && !document.querySelector('iframe')) {
      TV.sfx('deny');
      return TV.ui.toast('Nenhum vídeo nesta página');
    }
    const refused = await TV.api.runtime.sendMessage({ type: 'pip' });
    TV.sfx(refused ? 'deny' : 'select');
    if (refused) TV.ui.toast(refused, 3000);
  }

  function goHome() {
    if (TV.api && !TV.isHome) TV.api.runtime.sendMessage({ type: 'home' });
  }

  function exit() {
    if (TV.api) TV.api.runtime.sendMessage({ type: 'exit' });
  }

  function back() {
    if (TV.osk.isEditable(document.activeElement)) return document.activeElement.blur();
    if (stage() && TV.spatial.current()) return TV.spatial.clear();
    if (document.fullscreenElement) return document.exitFullscreen();
    if (ownControl('back')) return pressControl(site.controls.back); // sai do player pelo "voltar" dele
    if (!TV.isHome) history.back();
  }

  // Tela cheia nossa aberta (Controles, Janela flutuante): ela fica com todos os botões.
  const screen = () => [TV.controls, TV.floating].find((candidate) => candidate.isOpen());

  function onAction(action, source) {
    TV.ui.hideSystemCursor(true);
    if (screen()) return screen().action(action, source);
    // Com o ponteiro na tela, o A clica onde ele está; o direcional toma o lugar dele.
    if (action === 'select' && TV.cursor.active()) {
      if (!TV.osk.isOpen() && !TV.menu.isOpen()) TV.sfx('select'); // nos painéis, quem toca é o painel
      return TV.cursor.click();
    }
    const origin = DIRECTIONS.has(action) && TV.cursor.active() ? TV.cursor.hide() : null;

    if (action === 'pip') return pictureInPicture();
    if (TV.osk.isOpen()) return TV.osk.action(action);
    if (TV.menu.isOpen()) return TV.menu.action(action);
    if (action === 'menu') return TV.menu.open();
    if (action === 'home') {
      TV.sfx('back');
      return goHome();
    }
    if (action === 'homehint') return TV.isHome || TV.ui.toast(`Segure ${TV.pad.label('home')} para ir à tela inicial`);
    if (TV.hooks[action] && TV.hooks[action](TV.spatial.current())) return;
    if (site.mode === 'keys') {
      if (!PASSTHROUGH[action]) return;
      TV.sfx(DIRECTIONS.has(action) ? 'move' : action === 'back' ? 'back' : 'select');
      sendKey(PASSTHROUGH[action]);
      return;
    }

    const player = stage();
    const focused = TV.spatial.current();
    const step = (dir, from) => TV.spatial.move(dir, from) && TV.sfx('move');

    if (DIRECTIONS.has(action)) {
      if (origin && TV.spatial.focusAt(origin)) return TV.sfx('move');
      if (player && !focused && !origin) {
        if (action === 'left' || action === 'right') return seek(player, action === 'left' ? -10 : 10);
        // cima/baixo: acorda os controles e dá um instante pro site desenhá-los antes de focar
        wakeControls();
        return setTimeout(() => step(action), 150);
      }
      if (player) wakeControls();
      return step(action, origin);
    }

    switch (action) {
      case 'select':
        TV.sfx('select');
        if (focused) activate(focused, source);
        else if (player) toggle(player);
        else TV.spatial.focusFirst('down');
        break;
      case 'back':
        TV.sfx('back');
        back();
        break;
      case 'pageup': TV.spatial.scroll('up', 0.85); break;
      case 'pagedown': TV.spatial.scroll('down', 0.85); break;
      case 'rewind':
      case 'forward': {
        const video = mainVideo();
        if (video) seek(video, action === 'rewind' ? -10 : 10);
        break;
      }
      case 'media': {
        const video = mainVideo();
        if (video) toggle(video);
        break;
      }
      case 'keyboard': search(); break;
    }
  }

  // Quais teclas do teclado físico viram ação nossa. null = deixa o site/navegador tratar.
  function keyAction(event) {
    const action = KEYS[event.key];
    if (!action) return null;
    // Com o teclado virtual aberto, digitar e apagar no teclado físico continua valendo.
    if (screen()) return action;
    if (TV.osk.isOpen()) return event.key === 'Backspace' ? null : action;
    if (TV.menu.isOpen() || action === 'menu' || action === 'home' || action === 'pip') return action;
    if (site.mode === 'keys') return null;

    const active = document.activeElement;
    if (TV.osk.isEditable(active)) {
      if (event.key === 'Escape') return 'back';
      const multiline = active.tagName !== 'INPUT';
      if ((action === 'up' || action === 'down') && !multiline) return action;
      return null;
    }
    if (active && active.tagName === 'SELECT' && action !== 'left' && action !== 'right' && action !== 'back') return null;
    // Em site com atalhos próprios de player, o teclado físico fala direto com ele.
    if (site.seek === 'keys' && stage() && !TV.spatial.current() && (action === 'left' || action === 'right')) return null;
    return action;
  }

  window.addEventListener('mousemove', (event) => {
    if (event.isTrusted) TV.ui.hideSystemCursor(false);
  }, true);

  TV.input.listen(
    onAction,
    (dx, dy) => screen() || TV.spatial.analogScroll(dx, dy, TV.cursor.active() ? TV.cursor.point() : null),
    (dx, dy, dt) => {
      if (screen()) return;
      TV.ui.hideSystemCursor(true);
      TV.cursor.move(dx, dy, dt);
    }
  );

  // Site de resolução fixa: o background acerta o zoom (ver `fit` em tv/base.js). Mudar o zoom
  // dispara resize, que confere de novo; o background só mexe se a diferença for relevante.
  if (site.fit && TV.api) {
    const fit = () => TV.api.runtime.sendMessage({ type: 'fit', size: site.fit, view: [window.innerWidth, window.innerHeight] });
    fit();
    window.addEventListener('resize', fit);
  }

  // Com o site aberto, os ícones que ele declara vão pro cache que a tela inicial usa.
  window.addEventListener('load', () => {
    if (TV.api && !TV.isHome && location.protocol.startsWith('http')) {
      TV.api.runtime.sendMessage({ type: 'icon', hrefs: TV.icons.declared(document, location.href) });
    }
  });

  function frame(now) {
    TV.input.poll(now);
    TV.controls.tick(now);
    TV.cursor.tick(now);
    TV.spatial.track();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { keyAction, sendKey, activate, stage, goHome, exit, openKeyboard };
})();
