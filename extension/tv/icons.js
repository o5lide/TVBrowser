// Ícone de cada site, vindo do próprio site e guardado em cache (nada de logo embutido no projeto).
// Dois caminhos: a tela inicial lê a página do site e pega o <link rel="icon"> de maior resolução;
// e, quando o site é aberto de verdade, a página viva manda os ícones dela pro background (capture),
// o que resolve site que barra leitura automática ou só mostra o ícone depois do login.
TV.icons = (() => {
  const KEEP = 30 * 24 * 3600e3;  // refaz a busca depois de 30 dias
  const RETRY = 24 * 3600e3;      // se não achou ícone, tenta de novo no dia seguinte
  const VERSION = 2;              // muda quando a busca melhora, pra refazer o que já estava guardado
  const BIG = 96;                 // largura a partir da qual o ícone aguenta ser mostrado grande
  const store = TV.api ? TV.api.storage.local : null;
  const pending = new Map();

  // Um registro por site (sem o "www.", pra crunchyroll.com e www.crunchyroll.com serem o mesmo):
  // tela inicial e background gravam sem pisar um no outro.
  const keyOf = (url) => `icon:${new URL(url).hostname.replace(/^www\./, '')}`;

  async function saved(url) {
    if (!store) return null;
    const entry = (await store.get(keyOf(url)))[keyOf(url)];
    const fresh = entry && entry.version === VERSION && Date.now() - entry.at < (entry.icon ? KEEP : RETRY);
    return fresh ? entry : null;
  }

  function save(url, icon) {
    if (store) store.set({ [keyOf(url)]: { icon, at: Date.now(), version: VERSION } });
  }

  const largest = (sizes) => Math.max(0, ...(String(sizes || '').match(/\d+/g) || []).map(Number));
  const isSvg = (href, type) => /\.svg($|\?)/i.test(href) || type === 'image/svg+xml';

  // Ícones dos <link> da página, do maior pro menor: [{ href, size }].
  function links(doc, base) {
    const found = [];
    for (const link of doc.querySelectorAll('link[rel][href]')) {
      const rel = link.getAttribute('rel').toLowerCase();
      if (!rel.includes('icon') || rel.includes('mask')) continue;
      let href;
      try { href = new URL(link.getAttribute('href'), base).href; } catch { continue; }
      let size = largest(link.getAttribute('sizes')) || (rel.includes('apple') ? 180 : 32);
      if (isSvg(href, link.getAttribute('type'))) size = 512;
      found.push({ href, size });
    }
    return found.sort((a, b) => b.size - a.size);
  }

  const declared = (doc, base) => links(doc, base).map((icon) => icon.href);

  // Tudo que uma página oferece: os <link> e, se nenhum deles for grande, os ícones do manifesto de
  // app (site que se instala como aplicativo costuma ter 192 e 512 px lá).
  async function offered(pageUrl) {
    const response = await fetch(pageUrl, { credentials: 'include' });
    const page = new DOMParser().parseFromString(await response.text(), 'text/html');
    const found = links(page, response.url);
    const manifest = page.querySelector('link[rel~=manifest][href]');
    if (manifest && !(found[0] && found[0].size >= BIG)) {
      try {
        const url = new URL(manifest.getAttribute('href'), response.url).href;
        const app = await (await fetch(url, { credentials: 'include' })).json();
        for (const icon of app.icons || []) {
          if (/monochrome/.test(icon.purpose || '')) continue;
          const href = new URL(icon.src, url).href;
          found.push({ href, size: isSvg(href, icon.type) ? 512 : largest(icon.sizes) });
        }
        found.sort((a, b) => b.size - a.size);
      } catch {}
    }
    return found.map((icon) => icon.href);
  }

  function asDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Largura real da imagem; rejeita se o arquivo não for uma imagem que o navegador abra.
  function widthOf(data) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth || 512); // SVG sem tamanho próprio: serve em qualquer escala
      img.onerror = reject;
      img.src = data;
    });
  }

  // Baixa o primeiro endereço da lista que for mesmo uma imagem.
  async function download(hrefs) {
    for (const href of hrefs) {
      try {
        const response = await fetch(href, { credentials: 'include' });
        if (!response.ok) continue;
        const blob = await response.blob();
        const data = await asDataUrl(blob);
        const width = await widthOf(data);
        // SVG é desenho vetorial: serve em qualquer tamanho, não importa a largura declarada
        return { data, width: blob.type.includes('svg') ? 512 : width };
      } catch {}
    }
    return null;
  }

  // Procura na página pedida e, se dali não sair ícone grande, na página principal do site
  // (youtube.com/tv não declara ícone nenhum; youtube.com declara um de 144 px).
  async function find(siteUrl) {
    const root = new URL('/', siteUrl).href;
    let best = null;
    for (const pageUrl of siteUrl === root ? [root] : [siteUrl, root]) {
      let hrefs = [];
      try { hrefs = (await offered(pageUrl)).slice(0, 3); } catch {}
      const icon = await download(hrefs);
      if (icon && (!best || icon.width > best.width)) best = icon;
      if (best && best.width >= BIG) return best;
    }
    return best || download([new URL('/favicon.ico', siteUrl).href]);
  }

  // Devolve { data, width } (data: URL) ou null se o site não entregou ícone nenhum.
  function get(siteUrl) {
    const key = keyOf(siteUrl);
    if (!pending.has(key)) {
      pending.set(key, (async () => {
        const entry = await saved(siteUrl);
        if (entry) return entry.icon;
        const icon = await find(siteUrl);
        save(siteUrl, icon);
        return icon;
      })());
    }
    return pending.get(key);
  }

  // Ícones declarados pela página viva de um site (chega do content script, roda no background).
  async function capture(pageUrl, hrefs) {
    const entry = await saved(pageUrl);
    if (entry && entry.icon) return;
    const icon = await download([...hrefs.slice(0, 3), new URL('/favicon.ico', pageUrl).href]);
    if (icon) save(pageUrl, icon);
  }

  return { get, capture, declared, BIG };
})();
