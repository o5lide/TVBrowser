// Base compartilhada: carrega primeiro nos sites (content script), na tela inicial e no background.
// É `var` para a tela inicial expor window.TV (os testes dirigem o ponteiro por ali); num content
// script isso fica só no escopo isolado da extensão, o site não enxerga.
var TV = {
  api: typeof browser !== 'undefined' ? browser : null,

  // O YouTube só entrega a interface de TV (youtube.com/tv) para quem se apresenta como TV.
  // Não tem DRM nem certificação no meio: é só o cabeçalho User-Agent.
  TV_UA: 'Mozilla/5.0 (PS4; Leanback Shell) Gecko/20100101 Firefox/65.0 LeanbackShell/01.00.01.75 Sony PS4/ (PS4, , no, CH)',

  // Ajustes por site. Sem entrada aqui, vale o comportamento padrão (navegação espacial).
  //   mode: 'keys'  -> o site já foi feito pra controle remoto; o controle só vira setas/Enter/Esc
  //   seek: 'keys'  -> avançar/voltar o vídeo por tecla (mexer no currentTime derruba o player)
  //   search        -> endereço da busca do site (%s = o que foi digitado); sem isso, o Y procura
  //                    o campo ou o botão de busca na própria página
  //   fit: [l, a]   -> site desenhado para uma resolução fixa: o zoom é ajustado até a janela ter
  //                    esse tamanho. O YouTube TV mede tudo em frações da tela de 720p; em tamanho
  //                    "quebrado" (1536x864, por exemplo) o Firefox arredonda diferente do Chrome
  //                    e o menu lateral desmonta.
  //   controls      -> o player tem botões próprios, cada um dentro de um componente (aqui vai o nome
  //                    da tag): voltar, avançar, pausar e sair passam por eles. Na Disney+ o Isaac
  //                    relatou travamento ao voltar; clicar no botão do player, conferido ao vivo, não trava.
  sites: [
    { host: /(^|\.)youtube\.com$/, path: /^\/tv/, mode: 'keys', tvUserAgent: true, fit: [1280, 720] },
    {
      host: /(^|\.)disneyplus\.com$/,
      controls: { rewind: 'quick-rewind', forward: 'quick-fast-forward', toggle: 'toggle-play-pause', back: 'title-bug' },
    },
    { host: /(^|\.)netflix\.com$/, seek: 'keys', search: 'https://www.netflix.com/search?q=%s' },
    { host: /(^|\.)primevideo\.com$/, search: 'https://www.primevideo.com/search/?phrase=%s' },
    { host: /(^|\.)twitch\.tv$/, search: 'https://www.twitch.tv/search?term=%s' },
    { host: /(^|\.)crunchyroll\.com$/, search: 'https://www.crunchyroll.com/search?q=%s' },
    { host: /^globoplay\.globo\.com$/, search: 'https://globoplay.globo.com/busca/?q=%s' },
  ],

  // A tela inicial pendura comportamentos próprios aqui (ex.: X remove um bloco).
  hooks: {},
};

// Som de interface (nomes em tv/sound.js). Quem toca é o background.
TV.sfx = (name) => {
  if (TV.api) TV.api.runtime.sendMessage({ type: 'sound', name }).catch(() => {});
};

TV.site = TV.sites.find((s) => s.host.test(location.hostname) && (!s.path || s.path.test(location.pathname))) || {};

// O cabeçalho é trocado no background; aqui é o navigator.userAgent que o JavaScript da página enxerga.
if (TV.site.tvUserAgent && typeof exportFunction === 'function') {
  Object.defineProperty(window.wrappedJSObject.Navigator.prototype, 'userAgent', {
    get: exportFunction(() => TV.TV_UA, window),
    configurable: true,
    enumerable: true,
  });
}
