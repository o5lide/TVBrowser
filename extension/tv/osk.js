// Teclado virtual: abre ao selecionar um campo de texto com o controle.
TV.osk = (() => {
  const LAYERS = {
    abc: ['1234567890', 'qwertyuiop', 'asdfghjklç', 'zxcvbnm.-@'],
    sym: ['1234567890', '!?#$%&*()=', '+_/\\:;"\',~', '<>[]{}|^áã'],
  };
  const TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'password', 'tel', 'number']);

  let panel = null, title = null, preview = null, rows = null, hints = null;
  let target = null, layer = 'abc', shift = false, selected = null;
  let onConfirm = null; // modo pergunta: o texto vai pra quem pediu, não pra um campo da página

  function isEditable(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === 'TEXTAREA') return !el.readOnly;
    if (el.tagName === 'INPUT') return !el.readOnly && TEXT_TYPES.has((el.getAttribute('type') || '').toLowerCase());
    return el.isContentEditable;
  }

  function value() {
    return target.isContentEditable ? target.textContent : target.value;
  }

  // Setter nativo + evento "input": é o que faz React e companhia perceberem a mudança.
  function write(text) {
    if (target.isContentEditable) {
      target.textContent = text;
    } else {
      const proto = target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(target, text);
    }
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    render();
  }

  function key(label, action, cls) {
    const button = TV.ui.el('button', `key ${cls || ''}`, label);
    button.dataset.action = action;
    return button;
  }

  function build() {
    rows.textContent = '';
    for (const line of LAYERS[layer]) {
      const row = TV.ui.el('div', 'osk-row');
      for (const ch of line) {
        const shown = shift ? ch.toUpperCase() : ch;
        row.append(key(shown, `char:${shown}`));
      }
      rows.append(row);
    }
    const last = TV.ui.el('div', 'osk-row');
    last.append(
      key(shift ? '⇩' : '⇧', 'shift', 'mid'),
      key(layer === 'abc' ? '#+=' : 'abc', 'layer', 'mid'),
      key('espaço', 'char: ', 'wide'),
      key('.com', 'char:.com', 'mid'),
      key('⌫', 'backspace', 'mid'),
      key('OK', 'confirm', 'mid')
    );
    rows.append(last);
  }

  function select(button) {
    if (selected) selected.classList.remove('sel');
    selected = button;
    selected.classList.add('sel');
  }

  function rebuild(keepAction) {
    build();
    const keys = [...rows.querySelectorAll('.key')];
    select(keys.find((k) => k.dataset.action === keepAction) || keys[14]);
  }

  function render() {
    const text = target.type === 'password' ? '•'.repeat(value().length) : value();
    preview.textContent = text.slice(-70) + '▏';
  }

  function press(action) {
    if (action !== 'confirm') TV.sfx('key');
    if (action.startsWith('char:')) {
      write(value() + action.slice(5));
      if (shift) { shift = false; rebuild(action.toLowerCase()); }
    } else if (action === 'backspace') {
      write(value().slice(0, -1));
    } else if (action === 'shift') {
      shift = !shift;
      rebuild('shift');
    } else if (action === 'layer') {
      layer = layer === 'abc' ? 'sym' : 'abc';
      shift = false;
      rebuild('layer');
    } else if (action === 'confirm') {
      confirm();
    }
  }

  function confirm() {
    const field = target, answer = onConfirm;
    hide();
    TV.sfx('select');
    if (answer) return answer(field.value);
    field.dispatchEvent(new Event('change', { bubbles: true }));
    // Busca feita em JavaScript escuta o Enter; formulário comum precisa do envio explícito.
    const notHandled = TV.main.sendKey('Enter', field);
    if (notHandled && field.form) {
      try { field.form.requestSubmit(); } catch { field.form.submit(); }
    }
  }

  function moveSelection(dir) {
    const from = selected.getBoundingClientRect();
    let best = null, bestScore = Infinity;
    for (const k of rows.querySelectorAll('.key')) {
      if (k === selected) continue;
      const s = TV.spatial.score(from, k.getBoundingClientRect(), dir);
      if (s < bestScore) { best = k; bestScore = s; }
    }
    if (!best) return;
    select(best);
    TV.sfx('move');
  }

  function open(field, question) {
    const root = TV.ui.mount();
    if (!panel) {
      panel = TV.ui.el('div', 'panel osk');
      title = TV.ui.el('div', 'osk-title');
      preview = TV.ui.el('div', 'osk-preview');
      rows = TV.ui.el('div');
      hints = TV.ui.el('div');
      panel.append(title, preview, rows, hints);
      // mousedown não pode roubar o foco do campo
      panel.addEventListener('mousedown', (e) => e.preventDefault());
      panel.addEventListener('click', (e) => {
        const k = e.target.closest('.key');
        if (k) { select(k); press(k.dataset.action); }
      });
    }
    target = field;
    onConfirm = question ? question.onConfirm : null;
    title.textContent = question ? question.title : '';
    layer = 'abc';
    shift = false;
    try { field.focus({ preventScroll: true }); } catch {}
    // O teclado fica na metade oposta à do campo, pra não tampar o que está sendo digitado.
    const r = field.getBoundingClientRect();
    panel.classList.toggle('top', r.top + r.height / 2 > window.innerHeight / 2);
    // refeitas a cada abertura: os nomes dos botões seguem o controle em uso
    hints.replaceChildren(TV.pad.hints([[['select'], 'Digitar'], [['media'], 'Apagar'], [['keyboard'], 'Espaço'], [['menu'], 'Confirmar'], [['back'], 'Fechar']]));
    root.append(panel);
    rebuild();
    render();
    TV.sfx('open');
  }

  function hide() {
    if (panel) panel.remove();
    target = null;
    onConfirm = null;
  }

  function close() {
    hide();
    TV.sfx('close');
  }

  // Pergunta um texto sem depender de campo nenhum da página (usado pela busca).
  function ask(titleText, answer) {
    open(document.createElement('input'), { title: titleText, onConfirm: answer });
  }

  function action(a) {
    if (a === 'up' || a === 'down' || a === 'left' || a === 'right') moveSelection(a);
    else if (a === 'select') press(selected.dataset.action);
    else if (a === 'media') press('backspace');
    else if (a === 'keyboard') press('char: ');
    else if (a === 'menu') confirm();
    else if (a === 'back') close();
  }

  return { open, ask, close, action, isEditable, isOpen: () => target !== null };
})();
