// Navegação espacial: "direita" leva o foco para o elemento clicável mais próximo à direita, e assim por diante.
TV.spatial = (() => {
  const SELECTOR = [
    'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea', 'summary',
    '[tabindex]:not([tabindex="-1"])', '[role=button]', '[role=link]', '[role=menuitem]', '[role=tab]',
    '[role=option]', '[role=checkbox]', '[role=radio]', '[role=switch]',
    '[contenteditable=""]', '[contenteditable=true]', 'video[controls]',
  ].join(',');
  const TRIES = 12; // quantos candidatos, do melhor pro pior, passam pelos testes caros

  let current = null;

  const vw = () => window.innerWidth;
  const vh = () => window.innerHeight;

  // Site feito de web components (o player da Disney+, por exemplo) guarda os botões dentro de
  // shadow DOM: elementFromPoint e querySelectorAll do documento param na casca de fora.
  // openOrClosedShadowRoot só existe para extensão, no Firefox, e alcança também as fechadas.
  const shadowOf = (el) => (el.localName === 'tvb-layer' ? null : el.openOrClosedShadowRoot || el.shadowRoot);
  const parentOf = (el) => el.parentElement || el.getRootNode().host || null;

  function inside(el, ancestor) {
    for (let p = el; p; p = parentOf(p)) if (p === ancestor) return true;
    return false;
  }

  // O elemento mais fundo no ponto, atravessando as shadow roots.
  function at(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el) {
      const root = shadowOf(el);
      const inner = root && root.elementFromPoint(x, y);
      if (!inner || inner === el || inner.getRootNode() !== root) break;
      el = inner;
    }
    return el;
  }

  // querySelectorAll em `top` e em todas as shadow roots que houver dentro dele.
  function all(selector, top = document) {
    const trees = [top];
    for (let i = 0; i < trees.length; i++) {
      for (const el of trees[i].querySelectorAll('*')) {
        const root = shadowOf(el);
        if (root) trees.push(root);
      }
    }
    return trees.flatMap((tree) => [...tree.querySelectorAll(selector)]);
  }

  function rectOf(el) {
    if (el.disabled || el.closest('[aria-hidden="true"], [inert]')) return null;
    let rect = el.getBoundingClientRect();
    // <a> inline em volta de uma imagem em bloco mede quase zero: vale a caixa do filho.
    if ((rect.width < 6 || rect.height < 6) && el.firstElementChild) rect = el.firstElementChild.getBoundingClientRect();
    return rect.width < 6 || rect.height < 6 ? null : rect;
  }

  function shown(el) {
    return !el.checkVisibility || el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  }

  // Custo de ir de `from` até `to` na direção pedida: o quanto anda pra frente + o desalinhamento
  // lateral (que pesa mais, pra preferir quem está na mesma linha/coluna). Infinity = não está nessa direção.
  function score(from, to, dir) {
    const horiz = dir === 'left' || dir === 'right';
    const fwd = dir === 'right' || dir === 'down';
    const a0 = horiz ? from.left : from.top, a1 = horiz ? from.right : from.bottom;
    const b0 = horiz ? to.left : to.top, b1 = horiz ? to.right : to.bottom;
    const ac = (a0 + a1) / 2, bc = (b0 + b1) / 2;
    if (fwd ? bc <= ac + 1 || b1 <= a1 + 1 : bc >= ac - 1 || b0 >= a0 - 1) return Infinity;
    const main = Math.max(0, fwd ? b0 - a1 : a0 - b1);
    const p0 = horiz ? from.top : from.left, p1 = horiz ? from.bottom : from.right;
    const q0 = horiz ? to.top : to.left, q1 = horiz ? to.bottom : to.right;
    const gap = Math.max(0, Math.max(p0, q0) - Math.min(p1, q1));
    const drift = Math.abs((p0 + p1) / 2 - (q0 + q1) / 2);
    return main + gap * 3 + drift * 0.25;
  }

  function coversScreen(node) {
    for (let p = node; p && p !== document.documentElement; p = parentOf(p)) {
      const position = getComputedStyle(p).position;
      if (position === 'fixed' || position === 'sticky') {
        const r = p.getBoundingClientRect();
        return r.width * r.height > vw() * vh() * 0.6;
      }
    }
    return true;
  }

  function related(el, hit) {
    if (inside(hit, el) || inside(el, hit)) return true;
    // Cartão com uma capa clicável por cima do link: o "irmão" que cobre conta como o mesmo alvo.
    let p = el;
    for (let i = 0; i < 3 && parentOf(p); i++) p = parentOf(p);
    return p !== document.body && p !== document.documentElement && inside(hit, p);
  }

  function reachable(el, rect) {
    if (!shown(el)) return false;
    // Parte cortada por um ancestral com overflow:hidden (carrossel) não existe pra quem está olhando.
    let x0 = rect.left, y0 = rect.top, x1 = rect.right, y1 = rect.bottom;
    for (let p = parentOf(el); p && p !== document.body && p !== document.documentElement; p = parentOf(p)) {
      const style = getComputedStyle(p);
      const clipX = style.overflowX === 'hidden' || style.overflowX === 'clip';
      const clipY = style.overflowY === 'hidden' || style.overflowY === 'clip';
      if (clipX || clipY) {
        const pr = p.getBoundingClientRect();
        if (clipX) { x0 = Math.max(x0, pr.left); x1 = Math.min(x1, pr.right); }
        if (clipY) { y0 = Math.max(y0, pr.top); y1 = Math.min(y1, pr.bottom); }
      }
      if (style.position === 'fixed') break;
    }
    if (x1 - x0 < rect.width * 0.5 || y1 - y0 < rect.height * 0.5) return false;

    // Coberto por outra coisa? Uma barra fixa pequena não conta (rolar resolve); um modal conta.
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (cx >= 0 && cy >= 0 && cx < vw() && cy < vh()) {
      const hit = at(cx, cy);
      if (hit && !related(el, hit) && coversScreen(hit)) return false;
    }
    return true;
  }

  function scope() {
    for (const modal of document.querySelectorAll('dialog[open], [aria-modal="true"]')) {
      const r = modal.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && shown(modal)) return modal;
    }
    return document;
  }

  function candidates() {
    const list = [];
    for (const el of all(SELECTOR, scope())) {
      if (el === current) continue;
      const rect = rectOf(el);
      if (!rect) continue;
      if (rect.bottom < -1.5 * vh() || rect.top > 2.5 * vh() || rect.right < -vw() || rect.left > 2 * vw()) continue;
      list.push({ el, rect });
    }
    return list;
  }

  // Foco atual, se ainda existir e estiver perto da tela (rolar pra longe "solta" o foco).
  function currentRect() {
    if (!current || !current.isConnected) return null;
    const rect = rectOf(current);
    if (!rect || !shown(current)) return null;
    if (rect.bottom < -0.5 * vh() || rect.top > 1.5 * vh()) return null;
    return rect;
  }

  function reveal(el) {
    const r = el.getBoundingClientRect();
    const outY = r.top < vh() * 0.1 || r.bottom > vh() * 0.9;
    const outX = r.left < 0 || r.right > vw();
    if (outY || outX) {
      el.scrollIntoView({ block: outY ? 'center' : 'nearest', inline: outX ? 'center' : 'nearest', behavior: 'smooth' });
    }
  }

  function focus(el) {
    current = el;
    // Campo de texto só ganha o foco de verdade ao ser selecionado: senão ele prende as setas.
    if (!TV.osk.isEditable(el)) {
      try { el.focus({ preventScroll: true }); } catch {}
    } else if (TV.osk.isEditable(document.activeElement)) {
      document.activeElement.blur();
    }
    reveal(el);
    track();
  }

  function clear() {
    current = null;
    TV.ui.hideRing();
  }

  function focusFirst(dir, list = candidates()) {
    const onScreen = list.filter(({ rect }) => rect.bottom > 0 && rect.top < vh() && rect.right > 0 && rect.left < vw());
    onScreen.sort((a, b) => (dir === 'up' ? b.rect.bottom - a.rect.bottom : a.rect.top - b.rect.top) || a.rect.left - b.rect.left);
    for (const c of onScreen.slice(0, TRIES * 2)) {
      if (reachable(c.el, c.rect)) {
        focus(c.el);
        return true;
      }
    }
    return false;
  }

  function scrollerFor(el, horiz) {
    for (let p = el; p && p !== document.body && p !== document.documentElement; p = parentOf(p)) {
      const style = getComputedStyle(p);
      const overflow = horiz ? style.overflowX : style.overflowY;
      const room = horiz ? p.scrollWidth - p.clientWidth : p.scrollHeight - p.clientHeight;
      if ((overflow === 'auto' || overflow === 'scroll') && room > 4) return p;
    }
    return document.scrollingElement || document.documentElement;
  }

  function scroll(dir, fraction) {
    const horiz = dir === 'left' || dir === 'right';
    const anchor = currentRect() ? current : at(vw() / 2, vh() / 2);
    const box = scrollerFor(anchor, horiz);
    const amount = (horiz ? box.clientWidth : box.clientHeight) * fraction * (dir === 'right' || dir === 'down' ? 1 : -1);
    box.scrollBy({ left: horiz ? amount : 0, top: horiz ? 0 : amount, behavior: 'smooth' });
  }

  // O direcional assumiu depois do ponteiro: se ele está em cima de algo clicável, o foco cai ali.
  function focusAt(point) {
    const under = at(point.x, point.y);
    const el = under && under.closest(SELECTOR);
    if (!el || !rectOf(el)) return false;
    focus(el);
    return true;
  }

  // `origin`: de onde partir quando não há foco (a posição em que o ponteiro estava).
  function move(dir, origin) {
    const list = candidates();
    const from = currentRect() || (origin && new DOMRect(origin.x, origin.y, 1, 1));
    if (!from) return focusFirst(dir, list);
    const ranked = [];
    for (const c of list) {
      c.score = score(from, c.rect, dir);
      if (c.score < Infinity) ranked.push(c);
    }
    ranked.sort((a, b) => a.score - b.score);
    for (const c of ranked.slice(0, TRIES)) {
      if (reachable(c.el, c.rect)) {
        focus(c.el);
        return true;
      }
    }
    scroll(dir, 0.6);
    return false;
  }

  // Chamado a cada quadro: o anel acompanha o elemento enquanto a página rola ou se mexe.
  function track() {
    if (!current) return;
    if (!current.isConnected) return clear();
    const rect = current.getBoundingClientRect();
    // data-tvb-noring: a página desenha o próprio destaque (a roda da tela inicial)
    if (rect.width < 1 || rect.height < 1 || current.closest('[data-tvb-noring]')) return TV.ui.hideRing();
    TV.ui.showRing(rect);
  }

  // Rola o que estiver debaixo do ponto (o ponteiro, se houver; senão o meio da tela).
  let scrollBox = null, scrollBoxAt = 0;
  function analogScroll(dx, dy, point) {
    const now = performance.now();
    if (!scrollBox || now - scrollBoxAt > 500) {
      const spot = point || { x: vw() / 2, y: vh() / 2 };
      scrollBox = scrollerFor(at(spot.x, spot.y), Math.abs(dx) > Math.abs(dy));
      scrollBoxAt = now;
    }
    scrollBox.scrollBy(dx * 28, dy * 28);
  }

  return {
    move, focus, focusAt, focusFirst, clear, track, scroll, analogScroll, score, at, all,
    current: () => (currentRect() ? current : null),
  };
})();
