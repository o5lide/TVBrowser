// Camada visual: anel de foco, avisos e os painéis (teclado e menu).
// Fica num shadow DOM fechado para o CSS do site não vazar pra cá, nem o nosso pra lá.
TV.ui = (() => {
  // mesma paleta e tipo da tela inicial (home/home.css)
  const HOT = '#d8f52a', INK = '#061a06', TEXT = '#dfffc8';
  const DISPLAY = 'Impact, Haettenschweiler, "Arial Narrow Bold", Bahnschrift, "DejaVu Sans Condensed", "Liberation Sans Narrow", sans-serif';
  const CSS = `
    * { box-sizing: border-box; font-family: system-ui, "Segoe UI", sans-serif; font-synthesis: style; }
    .ring { position: fixed; left: 0; top: 0; border: 3px solid ${HOT}; border-radius: 8px;
      box-shadow: 0 0 0 2px rgba(0,0,0,.75), 0 0 22px 6px rgba(141,255,74,.75);
      opacity: 0; transition: opacity .12s; }
    .ring.on { opacity: 1; }
    .pointer { position: fixed; left: 0; top: 0; width: clamp(24px, 3.6vh, 46px); height: clamp(24px, 3.6vh, 46px);
      opacity: 0; transition: opacity .15s;
      filter: drop-shadow(0 0 1.5px #000) drop-shadow(0 0 1.5px #000) drop-shadow(2px 3px 0 rgba(0,0,0,.7)); }
    .pointer::before { content: ""; position: absolute; inset: 0; background: ${HOT};
      clip-path: polygon(0 0, 0 82%, 24% 62%, 40% 100%, 54% 94%, 38% 58%, 70% 58%); }
    .pointer.on { opacity: 1; }
    .toast { position: fixed; left: 50%; top: 8vh; transform: translateX(-50%) rotate(-2deg);
      background: ${HOT}; color: ${INK}; font: italic 400 clamp(18px, 2.2vw, 38px)/1 ${DISPLAY};
      letter-spacing: .05em; text-transform: uppercase; padding: .45em 1.2em;
      clip-path: polygon(3% 0, 100% 0, 97% 100%, 0 100%); opacity: 0; transition: opacity .15s; }
    .toast.on { opacity: 1; }
    .panel { pointer-events: auto; position: fixed; background: rgba(2,10,2,.97); color: ${TEXT};
      border: 3px solid ${HOT}; box-shadow: 10px 10px 0 #000, -3px -3px 0 rgba(255,255,255,.8); }
    .osk .hints { justify-content: center; margin-top: 14px; }

    .osk { left: 50%; transform: translateX(-50%); bottom: 4vh; width: min(92vw, 1100px); padding: 18px; }
    .osk.top { bottom: auto; top: 4vh; }
    .osk-title { font: italic 400 clamp(16px, 1.5vw, 26px)/1 ${DISPLAY}; letter-spacing: .06em;
      text-transform: uppercase; color: ${HOT}; margin-bottom: 10px; }
    .osk-title:empty { display: none; }
    .osk-preview { min-height: 1.9em; font-size: clamp(20px, 2vw, 32px); padding: .3em .6em; color: #fff;
      background: #000; box-shadow: inset 0 0 0 2px rgba(141,255,74,.5); white-space: pre; overflow: hidden; }
    .osk-row { display: flex; gap: 8px; margin-top: 8px; }
    .key { flex: 1 1 0; min-width: 0; height: clamp(44px, 6.2vh, 72px); font-size: clamp(18px, 1.8vw, 30px);
      color: inherit; background: #0f3a0f; border: 0; border-radius: 4px; padding: 0; }
    .key.mid { flex: 1.6 1 0; }
    .key.wide { flex: 4 1 0; }
    .key.sel { background: ${HOT}; color: ${INK}; }

    .menu { right: 3vw; top: 50%; transform: translateY(-50%) rotate(-2deg); width: min(460px, 84vw); padding: 14px; }
    .menu-title { font: italic 400 clamp(16px, 1.4vw, 24px)/1 ${DISPLAY}; letter-spacing: .08em;
      text-transform: uppercase; color: ${HOT}; padding: .5em .8em .9em; }
    .item { display: block; width: 100%; text-align: left; padding: .5em .8em;
      font: italic 400 clamp(20px, 2vw, 34px)/1 ${DISPLAY}; letter-spacing: .05em; text-transform: uppercase;
      background: transparent; color: inherit; border: 0; }
    .item.sel { background: ${HOT}; color: ${INK}; clip-path: polygon(2.5% 0, 100% 0, 97.5% 100%, 0 100%); }
    .menu .hints { margin: 12px 0 2px; padding: 14px .8em 2px; border-top: 2px solid rgba(141,255,74,.4); }

    /* dicas de botão: o texto de cada botão vem de tv/pad.js (Xbox ou PlayStation) */
    .hints { display: flex; flex-wrap: wrap; align-items: center; gap: .5em 1.6em;
      font-size: clamp(12px, 1vw, 17px); color: rgba(223,255,200,.8); }
    .hints > span { display: inline-flex; align-items: center; gap: .5em; }
    .badge { display: inline-grid; place-items: center; min-width: 1.9em; height: 1.9em; padding: 0 .45em;
      border: 1.5px solid currentColor; border-radius: 1em; color: ${HOT};
      font: 600 .86em/1 system-ui, "Segoe UI", sans-serif; }
    .badge.wide { border-radius: .45em; }

    /* tela Controles */
    .controls { inset: 7vh 9vw; display: flex; flex-direction: column;
      padding: clamp(16px, 3vh, 34px) clamp(18px, 3vw, 44px); }
    .ctl-head { display: flex; align-items: center; gap: 1em; padding-bottom: .9em;
      border-bottom: 2px solid rgba(141,255,74,.35); }
    .ctl-head .menu-title { margin-right: auto; padding: 0; font-size: clamp(22px, 2.4vw, 40px); }
    .tab { padding: .45em 1em; background: transparent; border: 0; color: inherit;
      font: italic 400 clamp(15px, 1.5vw, 26px)/1 ${DISPLAY}; letter-spacing: .05em; text-transform: uppercase; }
    .tab.sel { background: ${HOT}; color: ${INK}; clip-path: polygon(4% 0, 100% 0, 96% 100%, 0 100%); }
    .ctl-body { flex: 1; min-height: 0; padding: 1.3em 0; font-size: clamp(13px, 1.15vw, 20px); }
    .ctl-foot { padding-top: .9em; border-top: 2px solid rgba(141,255,74,.35); }
    .ctl-guide { display: grid; grid-template-columns: 1.15fr 1fr; align-content: start; gap: 1.1em 3em; height: 100%; }
    .ctl-guide section:first-child { grid-row: span 3; }
    .ctl-guide h3 { margin: 0 0 .5em; color: ${HOT};
      font: italic 400 1.15em/1 ${DISPLAY}; letter-spacing: .08em; text-transform: uppercase; }
    .ctl-row { display: flex; align-items: center; gap: 1em; padding: .3em 0; }
    .ctl-keys { display: inline-flex; flex: none; align-items: center; gap: .35em; min-width: 7em; }
    .ctl-keys i { font-style: normal; opacity: .6; }
    .ctl-muted { opacity: .65; }
    .ctl-style { display: flex; align-items: baseline; gap: .8em; }
    .ctl-style strong { color: ${HOT}; }
    .ctl-test { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.4em; height: 100%; }
    .ctl-info { display: flex; flex-direction: column; align-items: center; gap: .3em; text-align: center; }
    .ctl-info strong { font-size: 1.15em; }

    /* tela Janela flutuante: uma miniatura da tela com o retângulo do vídeo */
    /* a largura sai da altura que sobra: a miniatura é 16:9 e o painel inteiro tem que caber na tela */
    .floating { left: 50%; top: 50%; transform: translate(-50%, -50%);
      width: min(78vw, calc((84vh - 13em) * 16 / 9));
      padding: clamp(16px, 3vh, 34px) clamp(18px, 3vw, 44px); font-size: clamp(13px, 1.15vw, 20px); }
    .floating .menu-title { padding: 0 0 .3em; font-size: clamp(22px, 2.4vw, 40px); }
    .fl-screen { position: relative; aspect-ratio: 16 / 9; margin: 1.2em 0 .9em; background: #000;
      border: 2px solid rgba(141,255,74,.45); }
    .fl-box { position: absolute; display: grid; place-items: center; background: ${HOT}; color: ${INK};
      font: italic 400 1em/1 ${DISPLAY}; letter-spacing: .06em; text-transform: uppercase;
      transition: left .15s, top .15s, width .15s, height .15s; }
    .fl-status { margin-bottom: 1em; color: ${HOT}; }

    /* desenho do controle: tudo em "em", cresce junto com a letra */
    .diagram { position: relative; width: 30em; height: 17.5em; font-size: clamp(11px, min(1.25vw, 2.6vh), 30px); }
    .p-body { position: absolute; left: 1.5em; top: 3.6em; width: 27em; height: 13em;
      border: 2px solid rgba(141,255,74,.55); border-radius: 5em 5em 6.5em 6.5em; background: rgba(141,255,74,.05); }
    .part { position: absolute; display: grid; place-items: center; background: #071607; color: ${TEXT};
      border: 2px solid rgba(141,255,74,.55); font: 600 .78em/1 system-ui, "Segoe UI", sans-serif; }
    .part.on, .knob.on { background: ${HOT}; border-color: ${HOT}; color: ${INK}; }
    .p-lt, .p-rt { top: 0; width: 4.6em; height: 1.7em; border-radius: .6em .6em .2em .2em;
      background: linear-gradient(to top, ${HOT} calc(var(--fill, 0) * 100%), #071607 0); }
    .p-lb, .p-rb { top: 2em; width: 6.4em; height: 1.4em; border-radius: .7em; }
    .p-lt { left: 4.4em; } .p-rt { right: 4.4em; } .p-lb { left: 3.5em; } .p-rb { right: 3.5em; }
    .p-up, .p-down, .p-left, .p-right { width: 1.5em; height: 1.5em; border-radius: .25em; }
    .p-up { left: 9.85em; top: 9.95em; } .p-down { left: 9.85em; top: 12.95em; }
    .p-left { left: 8.35em; top: 11.45em; } .p-right { left: 11.35em; top: 11.45em; }
    .p-view, .p-menu { top: 6.6em; width: 1.7em; height: 1.1em; border-radius: .55em; }
    .p-view { left: 11.8em; } .p-menu { left: 16.5em; }
    .p-guide { left: 14em; top: 4.7em; width: 2em; height: 2em; border-radius: 50%; }
    .p-y, .p-x, .p-b, .p-a { width: 2em; height: 2em; border-radius: 50%; }
    .p-y { left: 21.5em; top: 4.7em; } .p-x { left: 19.5em; top: 6.7em; }
    .p-b { left: 23.5em; top: 6.7em; } .p-a { left: 21.5em; top: 8.7em; }
    .stick { position: absolute; display: grid; place-items: center; width: 4.2em; height: 4.2em;
      border: 2px solid rgba(141,255,74,.55); border-radius: 50%; }
    .p-ls { left: 4.2em; top: 5.2em; } .p-rs { left: 16.6em; top: 10em; }
    .knob { width: 2.3em; height: 2.3em; background: #0f3a0f; border: 2px solid rgba(141,255,74,.55); border-radius: 50%; }
  `;

  let host = null, root = null, ring = null, pointer = null, toastEl = null, toastTimer = 0, cursorStyle = null;

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function mount() {
    if (!host) {
      host = document.createElement('tvb-layer');
      host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
      root = host.attachShadow({ mode: 'closed' });
      const style = el('style');
      style.textContent = CSS;
      ring = el('div', 'ring');
      toastEl = el('div', 'toast');
      pointer = el('div', 'pointer');
      root.append(style, ring, toastEl, pointer);
    }
    // Em tela cheia só aparece o que está dentro do elemento em tela cheia.
    const parent = document.fullscreenElement || document.documentElement;
    if (parent && host.parentNode !== parent && parent.tagName !== 'VIDEO') parent.appendChild(host);
    return root;
  }

  function showRing(rect) {
    mount();
    ring.style.transform = `translate(${rect.left - 5}px, ${rect.top - 5}px)`;
    ring.style.width = `${rect.width + 10}px`;
    ring.style.height = `${rect.height + 10}px`;
    ring.classList.add('on');
  }

  function hideRing() {
    if (ring) ring.classList.remove('on');
  }

  function toast(text) {
    mount();
    toastEl.textContent = text;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 900);
  }

  // O ponteiro do mouse virtual (analógico esquerdo). Fica por último no shadow DOM: acima dos painéis.
  function showPointer(x, y) {
    mount();
    if (root.lastChild !== pointer) root.append(pointer);
    pointer.style.transform = `translate(${x}px, ${y}px)`;
    pointer.classList.add('on');
  }

  function hidePointer() {
    if (pointer) pointer.classList.remove('on');
  }

  // O que há de nosso (tecla do teclado virtual, item do menu) no ponto, se houver.
  function hit(x, y) {
    const found = root && root.elementFromPoint(x, y);
    return found && found.closest('.panel') ? found : null;
  }

  // Com controle na mão, o ponteiro do mouse de verdade parado no meio da tela só atrapalha.
  function hideSystemCursor(hide) {
    if (!cursorStyle) {
      cursorStyle = el('style');
      cursorStyle.textContent = 'html.tvb-nocursor, html.tvb-nocursor * { cursor: none !important; }';
      (document.head || document.documentElement).appendChild(cursorStyle);
    }
    document.documentElement.classList.toggle('tvb-nocursor', hide);
  }

  document.addEventListener('fullscreenchange', () => host && mount());

  return { el, mount, showRing, hideRing, showPointer, hidePointer, hit, toast, hideSystemCursor };
})();
