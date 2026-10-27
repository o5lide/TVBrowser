const HOME = browser.runtime.getURL('home/index.html');
const YT_TV = 'https://www.youtube.com/tv';

// O lançador abre o Firefox numa aba em branco e só depois carrega a extensão.
const isBlank = (url) => /^about:(blank|home|newtab|welcome)/.test(url || 'about:blank');
async function sendBlankTabsHome() {
  for (const tab of await browser.tabs.query({})) {
    if (isBlank(tab.url)) browser.tabs.update(tab.id, { url: HOME });
  }
}
sendBlankTabsHome();

// Se o Firefox abre rápido, a extensão entra antes de a aba em branco do lançador terminar de
// carregar, e ela carrega por cima da tela inicial (visto no Bazzite aberto pelo Steam: extensão em
// 1,09 s, sessão pronta em 1,38 s). Então, nos primeiros segundos, aba que termina em branco vai pra
// tela inicial. Só nos primeiros segundos: janela que site abre (login) também nasce em branco.
function blankLoaded(tabId, change, tab) {
  if (change.status === 'complete' && isBlank(tab.url)) browser.tabs.update(tabId, { url: HOME });
}
browser.tabs.onUpdated.addListener(blankLoaded);
setTimeout(() => browser.tabs.onUpdated.removeListener(blankLoaded), 15000);

// O lançador fica pendurado em nextLauncherRequest() pela porta de depuração: é por onde a extensão
// pede o que só o navegador pode fazer (o picture-in-picture, ver pipmode.py).
let wakeLauncher = null, queued = null;
globalThis.nextLauncherRequest = () => new Promise((resolve) => {
  if (queued) resolve(queued);
  else wakeLauncher = resolve;
  queued = null;
});
function askLauncher(what) {
  if (wakeLauncher) wakeLauncher(what);
  else queued = what;
  wakeLauncher = null;
}

browser.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg.type === 'home') {
    browser.tabs.update(sender.tab.id, { url: HOME });
  } else if (msg.type === 'exit') {
    for (const win of await browser.windows.getAll()) browser.windows.remove(win.id);
  } else if (msg.type === 'icon') {
    TV.icons.capture(sender.url, msg.hrefs);
  } else if (msg.type === 'sound') {
    return TV.sound.play(msg.name);
  } else if (msg.type === 'pip') {
    // o lançador avisa quando não dá (Modo Jogo do Steam, ver pipmode.blocked); a página mostra o motivo
    if (globalThis.pipBlocked) return globalThis.pipBlocked;
    // posição e tamanho escolhidos em "Janela flutuante" (tv/floating.js) vão junto com o pedido
    const { floating } = await browser.storage.local.get('floating');
    askLauncher(JSON.stringify({ col: 2, row: 2, width: 0.33, ...floating }));
  } else if (msg.type === 'fit') {
    // msg.view é a janela no zoom atual; o zoom certo é o que a deixa do tamanho pedido
    const zoom = await browser.tabs.getZoom(sender.tab.id);
    const wanted = Math.min((msg.view[0] * zoom) / msg.size[0], (msg.view[1] * zoom) / msg.size[1]);
    if (Math.abs(wanted - zoom) > 0.02) browser.tabs.setZoom(sender.tab.id, wanted);
  }
});

// Interface de TV do YouTube: só as requisições da própria página /tv saem com User-Agent de TV.
browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const fromTv = details.url.startsWith(YT_TV) || (details.documentUrl || '').startsWith(YT_TV);
    if (!fromTv) return {};
    for (const header of details.requestHeaders) {
      if (header.name.toLowerCase() === 'user-agent') header.value = TV.TV_UA;
    }
    return { requestHeaders: details.requestHeaders };
  },
  { urls: ['*://*.youtube.com/*'] },
  ['blocking', 'requestHeaders']
);
