TV.isHome = true;

// A roda: os itens ficam num arco em volta do orbe, e o selecionado é sempre o do meio.
const STEP = 11.5;   // distância vertical entre itens (vh)
const RADIUS = 62;   // raio do arco (vh)
const REACH = 30;    // distância do centro do orbe até o item do meio (vh)
const VISIBLE = 2;   // quantos itens aparecem acima e abaixo do selecionado (mais que isso bate nas faixas)
const BIG_ICON = TV.icons.BIG; // a partir dessa largura o ícone tem definição pra preencher o espaço

const store = TV.api ? TV.api.storage.local : null;
const wheel = document.getElementById('wheel');
const orb = document.getElementById('orb');
const mark = document.getElementById('mark');
const ghost = document.getElementById('ghost');
const catalog = document.getElementById('catalog');
const cards = document.getElementById('cards');
const addForm = document.getElementById('add');
const addUrl = document.getElementById('add-url');

let sites = TV.catalog.filter((entry) => entry.starter).map(({ name, url, note }) => ({ name, url, note }));
let entries = [];
let selected = 0;
let removing = -1; // índice do site esperando o segundo X

const initial = (name) => name.trim()[0].toUpperCase();
const sameSite = (a, b) => new URL(a).origin === new URL(b).origin;

function iconImage(icon) {
  const img = new Image();
  img.alt = '';
  img.src = icon.data;
  img.classList.toggle('full', icon.width >= BIG_ICON);
  return img;
}

// Troca a inicial pelo ícone do site quando (e se) ele chegar.
function withIcon(holder, url, onLoad) {
  if (!url) return;
  TV.icons.get(url).then((icon) => {
    if (!icon) return;
    holder.replaceChildren(iconImage(icon));
    if (onLoad) onLoad(icon);
  });
}

function makeItem(tag, name, glyph, site) {
  const item = TV.ui.el(tag, 'item');
  const node = TV.ui.el('span', 'node', glyph);
  const bar = TV.ui.el('span', 'bar');
  bar.append(TV.ui.el('span', 'label', name));
  if (site && site.note) bar.append(TV.ui.el('span', 'note', site.note));
  item.append(node, TV.ui.el('span', 'link'), bar);
  item.dataset.name = name;
  item.dataset.glyph = glyph;
  if (site) {
    item.href = site.url;
    withIcon(node, site.url, (icon) => {
      item.icon = icon;
      if (entries[selected] === item) showMark(item);
    });
  }
  return item;
}

// O centro do orbe mostra o ícone do site selecionado num quadro; sem ícone (Adicionar, Sair, site
// que não entregou nenhum), fica a inicial.
function showMark(item) {
  if (!item.icon) return void (mark.textContent = item.dataset.glyph);
  const img = iconImage(item.icon);
  // ícone pequeno fica no meio do quadro, ampliado no máximo 4x pra não virar borrão
  if (item.icon.width < BIG_ICON) img.style.maxWidth = img.style.maxHeight = `${item.icon.width * 4}px`;
  const tile = TV.ui.el('span', 'tile');
  tile.append(img);
  mark.replaceChildren(tile);
}

function layout() {
  const count = entries.length;
  entries.forEach((item, index) => {
    // distância circular até o selecionado: depois do último vem o primeiro
    let d = (((index - selected) % count) + count) % count;
    if (d > count / 2) d -= count;
    const y = d * STEP;
    const x = REACH + Math.sqrt(Math.max(0, RADIUS * RADIUS - y * y)) - RADIUS;
    const tilt = (Math.asin(Math.max(-1, Math.min(1, y / RADIUS))) * 180) / Math.PI * 0.4;
    const scale = d === 0 ? 1.14 : 1 - Math.abs(d) * 0.05;
    const far = Math.abs(d) > VISIBLE;
    item.style.transform = `translate(${x}vh, ${y}vh) rotate(${tilt}deg) scale(${scale})`;
    item.style.opacity = far ? 0 : 1 - Math.abs(d) * 0.22;
    item.style.zIndex = 10 - Math.abs(d);
    item.classList.toggle('sel', d === 0);
    item.classList.toggle('far', far);
  });
}

function replay(el) {
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

function select(index) {
  selected = ((index % entries.length) + entries.length) % entries.length;
  const item = entries[selected];
  layout();
  showMark(item);
  ghost.textContent = item.dataset.name;
  [mark, ghost, orb].forEach(replay);
  TV.spatial.focus(item);
}

function fillTickers() {
  const half = [];
  for (let i = 0; half.length < 24; i++) half.push(sites[i % sites.length] || { name: 'TV Browser' });
  for (const track of document.querySelectorAll('.ticker .track')) {
    track.textContent = '';
    // duas metades iguais: quando a primeira sai inteira da tela, a animação recomeça sem emenda
    for (const site of [...half, ...half]) {
      const chip = TV.ui.el('span', 'chip');
      const icon = TV.ui.el('span', 'icon');
      withIcon(icon, site.url);
      chip.append(icon, site.name);
      track.append(chip);
    }
  }
}

function render() {
  entries = sites.map((site) => makeItem('a', site.name, initial(site.name), site));

  const add = makeItem('button', 'Adicionar', '+');
  add.addEventListener('click', openCatalog);
  const exit = makeItem('button', 'Sair', '×');
  exit.addEventListener('click', () => TV.main.exit());
  entries.push(add, exit);

  entries.forEach((item, index) => {
    item.style.setProperty('--n', index);
    // clique num item que não é o do meio só o traz pro meio
    item.addEventListener('click', (event) => {
      if (index === selected) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      select(index);
    }, true);
  });

  wheel.replaceChildren(...entries);
  fillTickers();
  select(Math.min(selected, entries.length - 1));
}

async function save() {
  if (store) await store.set({ sites });
  render();
}

function addSite(site) {
  sites = [...sites, site];
  selected = sites.length - 1;
  closePanels();
  save();
}

// ---------- adicionar: catálogo de serviços e, pra quem não está nele, o endereço digitado ----------

function makeCard(name, about, glyph, url) {
  const card = TV.ui.el('button', 'card');
  const icon = TV.ui.el('span', 'icon', glyph);
  const text = TV.ui.el('span');
  text.append(TV.ui.el('b', '', name), TV.ui.el('small', '', about));
  card.append(icon, text);
  card.type = 'button';
  withIcon(icon, url);
  return card;
}

function openCatalog() {
  const offered = TV.catalog.filter((entry) => !sites.some((site) => sameSite(site.url, entry.url)));
  cards.replaceChildren(...offered.map((entry) => {
    const card = makeCard(entry.name, entry.about, initial(entry.name), entry.url);
    card.addEventListener('click', () => addSite({ name: entry.name, url: entry.url, note: entry.note }));
    return card;
  }));
  const other = makeCard('Outro site', 'Digitar o endereço', '+');
  other.addEventListener('click', () => {
    catalog.hidden = true;
    addForm.hidden = false;
    addUrl.value = '';
    TV.spatial.focus(addUrl);
  });
  cards.append(other);

  catalog.hidden = false;
  wheel.inert = true;
  TV.spatial.focus(cards.firstElementChild);
  TV.sfx('open');
}

function closePanels() {
  catalog.hidden = true;
  addForm.hidden = true;
  wheel.inert = false;
  select(selected);
}

addForm.addEventListener('submit', (event) => {
  event.preventDefault();
  let url;
  try {
    const typed = addUrl.value.trim();
    url = new URL(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`);
  } catch {
    return TV.ui.toast('Endereço inválido');
  }
  addSite({ name: url.hostname.replace(/^www\./, ''), url: url.href });
});

document.getElementById('add-cancel').addEventListener('click', closePanels);

// ---------- controle ----------

// Com a roda ativa, o direcional gira a roda em vez de procurar o vizinho na tela.
const onWheel = () => catalog.hidden && addForm.hidden;
const turn = (by) => {
  select(selected + by);
  TV.sfx('wheel');
  return true;
};
TV.hooks.up = () => onWheel() && turn(-1);
TV.hooks.down = () => onWheel() && turn(1);
TV.hooks.left = TV.hooks.right = onWheel;
TV.hooks.select = () => onWheel() && (TV.sfx('select'), entries[selected].click(), true);
TV.hooks.keyboard = () => onWheel() && (openCatalog(), true);
TV.hooks.back = () => !onWheel() && (TV.sfx('close'), closePanels(), true);

// X remove o site selecionado; pede um segundo X pra não apagar sem querer.
TV.hooks.media = () => {
  if (!onWheel() || selected >= sites.length) return onWheel();
  if (removing !== selected) {
    removing = selected;
    TV.ui.toast(`X de novo para remover ${sites[selected].name}`);
    setTimeout(() => { removing = -1; }, 3000);
    return true;
  }
  removing = -1;
  sites = sites.filter((_, index) => index !== selected);
  TV.sfx('back');
  save();
  return true;
};

wheel.addEventListener('wheel', (event) => {
  if (onWheel()) select(selected + (event.deltaY > 0 ? 1 : -1));
}, { passive: true });

// Dicas do rodapé, com os nomes dos botões do controle em uso.
function drawHints() {
  document.querySelector('footer').replaceChildren(TV.pad.hints([
    [['select'], 'Abrir'], [['keyboard'], 'Adicionar'], [['media'], 'Remover'], [['menu'], 'Menu'],
  ]));
}
TV.pad.onChange(drawHints);
drawHints();

// ---------- fundo e relógio ----------

function drawGrid() {
  const NS = 'http://www.w3.org/2000/svg';
  const grid = document.getElementById('grid');
  for (const r of [60, 95, 135, 180, 230, 285, 345, 410, 480]) {
    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('r', r);
    grid.append(circle);
  }
  for (let angle = 0; angle < 360; angle += 10) {
    const rad = (angle * Math.PI) / 180;
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', Math.cos(rad) * 60);
    line.setAttribute('y1', Math.sin(rad) * 60);
    line.setAttribute('x2', Math.cos(rad) * 480);
    line.setAttribute('y2', Math.sin(rad) * 480);
    grid.append(line);
  }
}

function tick() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

drawGrid();
tick();
setInterval(tick, 10000);
setTimeout(() => document.body.classList.remove('intro'), 1400);

(store ? store.get('sites') : Promise.resolve({})).then((stored) => {
  if (Array.isArray(stored.sites)) sites = stored.sites;
  render();
  TV.sfx('boot');
});
