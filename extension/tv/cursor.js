// Mouse virtual: o analógico esquerdo move um ponteiro desenhado por nós, e o A clica onde ele está.
// Os eventos são fabricados (o site recebe mousemove/mousedown/click normais), então o que o site
// faz por JavaScript responde, mas o :hover do CSS não acende.
TV.cursor = (() => {
  const SPEED = 1.25; // alturas de tela por segundo com o analógico no fim do curso
  const IDLE = 4000;  // ms parado em cima de um vídeo em tela cheia até o ponteiro sumir

  let x = 0, y = 0, on = false, hovered = null, movedAt = 0;

  function fire(el, type, extra) {
    const Kind = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    return el.dispatchEvent(new Kind(type, {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y, button: 0,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, ...extra,
    }));
  }

  // Avisa o site por onde o ponteiro está passando (é o que faz aparecer controle de player).
  function hover() {
    const el = TV.ui.hit(x, y) ? null : TV.spatial.at(x, y);
    if (el !== hovered) {
      if (hovered && hovered.isConnected) {
        fire(hovered, 'pointerout', { relatedTarget: el });
        fire(hovered, 'mouseout', { relatedTarget: el });
      }
      if (el) {
        fire(el, 'pointerover', { relatedTarget: hovered });
        fire(el, 'mouseover', { relatedTarget: hovered });
      }
      hovered = el;
    }
    if (el) {
      fire(el, 'pointermove');
      fire(el, 'mousemove');
    }
  }

  function move(dx, dy, dt) {
    if (!on) {
      on = true;
      if (!x && !y) { x = window.innerWidth / 2; y = window.innerHeight / 2; }
      TV.spatial.clear();
    }
    // devagar perto do centro (pra acertar botão pequeno), rápido no fim do curso
    const tilt = Math.min(1, Math.hypot(dx, dy));
    const step = ((0.15 + 0.85 * tilt * tilt) * SPEED * window.innerHeight * dt) / 1000;
    const nx = x + (dx / tilt) * step, ny = y + (dy / tilt) * step;
    x = Math.max(0, Math.min(window.innerWidth - 1, nx));
    y = Math.max(0, Math.min(window.innerHeight - 1, ny));
    // empurrar o ponteiro contra a borda rola a página
    if (nx !== x || ny !== y) TV.spatial.analogScroll(nx !== x ? dx : 0, ny !== y ? dy : 0, { x, y });
    movedAt = performance.now();
    TV.ui.showPointer(x, y);
    hover();
  }

  function click() {
    movedAt = performance.now();
    TV.ui.showPointer(x, y);
    const ours = TV.ui.hit(x, y); // tecla do teclado virtual ou item do menu
    if (ours) return ours.click();
    if (TV.osk.isOpen() || TV.menu.isOpen()) return;
    const el = TV.spatial.at(x, y);
    if (!el) return;
    if (TV.osk.isEditable(el) || el.tagName === 'SELECT' || (el.tagName === 'VIDEO' && el.controls)) {
      return TV.main.activate(el, 'gamepad');
    }
    fire(el, 'pointerdown', { buttons: 1 });
    fire(el, 'mousedown', { buttons: 1, detail: 1 });
    const focusable = el.closest('a[href], button, [tabindex]');
    try { if (focusable) focusable.focus({ preventScroll: true }); } catch {}
    fire(el, 'pointerup');
    fire(el, 'mouseup', { detail: 1 });
    fire(el, 'click', { detail: 1 });
  }

  // Some com o ponteiro (o direcional assumiu) e devolve onde ele estava.
  function hide() {
    on = false;
    TV.ui.hidePointer();
    if (hovered && hovered.isConnected) {
      fire(hovered, 'pointerout');
      fire(hovered, 'mouseout');
    }
    hovered = null;
    return { x, y };
  }

  let checkedAt = 0;
  function tick(now) {
    // procurar o vídeo varre a página: uma vez por segundo basta
    if (!on || now - movedAt < IDLE || now - checkedAt < 1000) return;
    checkedAt = now;
    if (TV.main.stage()) hide();
  }

  return { move, click, hide, tick, active: () => on, point: () => ({ x, y }) };
})();
