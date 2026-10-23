# TV Browser

Navegador de sofá: o Firefox em tela cheia, com tela inicial de TV e navegação por controle.
Não é um fork: é o Firefox instalado na máquina, aberto num perfil separado, com uma extensão
própria (`extension/`) carregada pelo lançador (`tvbrowser.py`).

## Abrir

- **Windows:** dois cliques em `TV Browser.bat`.
- **Linux:** `chmod +x tvbrowser.sh` uma vez, depois `./tvbrowser.sh`.
- **Steam:** dois cliques em `Instalar no Steam.bat` (no Linux, `./tvbrowser.sh --steam`). Ele
  cria o jogo não-Steam "TV Browser" já com ícone, capas, fundo e logo; se o atalho já existir,
  só aponta para esta pasta e troca a arte. Para criar ou corrigir o atalho o Steam precisa estar
  fechado (o instalador espera você fechar); para só trocar a arte, não. O código está em `steam.py`.
  Para um atalho que já abre num site, pôr nas opções de inicialização `--url https://www.netflix.com`.
  No Windows, o Firefox aberto impede o Steam de vir pra frente sozinho. Então, com o Big Picture
  aberto, a troca é feita por nós: com o TV Browser na frente, apertar e soltar o Guia passa a
  frente ao Big Picture (Guia em combinação, como Guia + analógico pro volume, não conta); de
  qualquer outro lugar (Steam, jogo), Start + Select traz o TV Browser de volta; e fechar o
  TV Browser devolve o foco ao Big Picture. Abrir o TV Browser com ele já aberto também só o traz
  pra frente. O controle precisa aparecer pelo XInput (o do Xbox aparece).

A arte fica em `assets/` e segue o tema da tela inicial; `python tools/make_art.py` gera tudo de
novo, e rodar o instalador outra vez leva a arte nova para o Steam.

Precisa de Firefox e Python 3, mais nada. Opções: `--windowed` (janela comum), `--url`,
`--check` (só confere se o Firefox abre e a extensão carrega).

## Mandar para alguém

`python tools/build_installer.py` monta os dois instaladores em `dist/`, cada um num arquivo só.
Nenhum leva o Firefox dentro: se faltar na máquina de quem instala, o instalador busca o oficial
na Mozilla e guarda uma cópia só do TV Browser.

**Linux: `TVBrowser-linux.run`** (1,6 MB). Roda com `sh TVBrowser-linux.run` (ou marcando o arquivo
como executável e dando dois cliques). Usa o Python 3 do sistema, não pede root e põe tudo em
`~/.local/share/tvbrowser`. Pergunta, em janela (kdialog/zenity) ou no terminal, se cria o atalho
no menu de aplicativos e se põe na biblioteca do Steam. Para tirar: `desinstalar.sh` na pasta
instalada. Os scripts estão em `tools/linux/`.

**Windows: `TVBrowser.exe`** (uns 10 MB), para quem não tem Python nem Firefox. Dois cliques e
abre uma janela com duas opções:

- **Modo TV sozinho:** atalho na Área de Trabalho e no Menu Iniciar.
- **Modo TV dentro do Steam:** entra na biblioteca com a arte, para abrir pelo Big Picture.

O que acontece por baixo: os arquivos vão para `%LOCALAPPDATA%\Programs\TV Browser` (sem pedir
administrador), junto com um Python mínimo copiado do Python de quem montou. Se a pessoa não
tiver Firefox, o instalador baixa o oficial da Mozilla, confere a assinatura digital e desempacota
uma cópia só do TV Browser dentro da pasta dele (não instala nada no sistema nem mexe no navegador
padrão); se tiver, usa o que está lá. A desinstalação aparece em "Aplicativos instalados" do
Windows. O instalador não é assinado, então o Windows mostra o aviso do SmartScreen na primeira
vez ("Mais informações" → "Executar assim mesmo"). O código da janela está em `instalar.py`.

O perfil (logins, cookies) fica fora do projeto: `%LOCALAPPDATA%\TvBrowser\perfil` no Windows,
`~/.local/share/tvbrowser/perfil` no Linux.

## Controle

| Botão | Ação |
| --- | --- |
| Direcional | move o foco |
| Analógico esquerdo | mouse: move um ponteiro, e o A clica onde ele está |
| Analógico direito | rola a página |
| A | seleciona (em campo de texto, abre o teclado virtual) |
| B | volta |
| Y | busca do site (na tela inicial: adicionar site) |
| X | play/pausa (na tela inicial: remove o site selecionado) |
| LB / RB | rola a página |
| LT / RT | volta / avança 10 s no vídeo |
| Start | menu (início, voltar, recarregar, teclado, controles, janela flutuante, sons, sair) |
| Select (segurar) | tela inicial; um toque só não faz nada |
| Start + Select | picture-in-picture: o vídeo vai para uma janela flutuante |

Mexer no direcional some com o ponteiro e leva o foco para o que estava debaixo dele. Com um
vídeo ocupando a tela toda, esquerda/direita voltam/avançam 10 s e A dá play/pausa; cima/baixo
trazem os controles do player para o foco, e B devolve ao modo vídeo.

O ponteiro é desenhado pela extensão e os cliques são eventos fabricados: o que o site faz por
JavaScript responde, mas o `:hover` do CSS não acende e não dá para clicar dentro de um iframe
de outro site.

Controle que o Firefox não reconhece como padrão Xbox precisa de um perfil em
`extension/tv/input.js` (hoje tem o do BridgePad). O menu do Start mostra, na última linha, o
nome do controle e os botões apertados, que é o que se precisa para escrever um perfil novo.

No teclado (ou Steam Input mandando teclas): setas, Enter, Esc/Backspace, F1 = menu, F2 = início,
F3 = picture-in-picture.

O menu tem a tela **Controles**: o guia de todos os botões e um teste do controle (cada botão
apertado acende no desenho). Os nomes dos botões na tela seguem o controle: A/B/X/Y ou ✕/○/◻/△.
O de PlayStation é reconhecido sozinho quando ligado direto; pelo Steam Input ele chega como
controle de Xbox, e aí a troca é manual, na própria tela (`extension/tv/pad.js`).

**Picture-in-picture.** Start + Select com um vídeo na tela abre a janela flutuante do Firefox, que
fica por cima de tudo. A página não pode abrir isso sozinha, então a extensão pede e quem executa
é o lançador, de dentro do navegador (`pipmode.py`). No Windows a janela flutuante deixa de
aceitar foco, o Big Picture passa pra frente e o TV Browser é minimizado, para dar lugar ao jogo;
o mesmo Start + Select traz tudo de volta (aí lido direto do controle, pelo XInput).

A extensão só obedece ao controle quando a janela dela está com o foco. Isso importa porque, com
a janela flutuante aberta, o Firefox mantém a página ativa mesmo minimizada: sem conferir o foco,
o TV Browser continuava reagindo aos botões enquanto se navegava no Steam ou se jogava. Onde a janela abre e de que
tamanho se escolhe no menu, em **Janela flutuante**: nove posições e cinco tamanhos (de 20% a 50%
da largura da tela), guardados e mandados ao lançador junto com o pedido.

Como Start e Select juntos são um comando, sozinhos eles não agem ao apertar: o Start abre o menu
ao soltar, e o Select só leva à tela inicial se ficar segurado. Assim um aperto torto dos dois não
fecha o que se está assistindo.

## Sons

Mover o foco, girar a roda, selecionar, voltar, abrir e fechar menu/teclado e a abertura da tela
inicial têm som. Não há arquivo de áudio: cada som é sintetizado na hora em
`extension/tv/sound.js` (notas e "sopros" descritos em poucas linhas, fáceis de mexer).
Para desligar: Start → "Sons".

## Por site

`extension/tv/base.js` tem a lista de ajustes por site. Hoje:

- **YouTube** abre em `youtube.com/tv`, a interface de TV de verdade. Ela só é entregue a quem
  se apresenta como TV, então só nessa página o User-Agent é trocado.
- **Netflix** avança/volta por tecla, porque mexer direto no tempo do vídeo derruba o player.
- **Busca (Y)**: Netflix, Prime Video, Globoplay, Twitch e Crunchyroll têm o endereço de busca
  cadastrado (o Y pergunta o texto e vai direto). Nos outros, o Y procura o campo ou a lupa na página.

Os serviços oferecidos em "Adicionar" ficam em `extension/home/catalog.js`. Os ícones não vêm no
projeto: são buscados no próprio site e guardados em cache (`extension/tv/icons.js`).

Netflix e Disney+ não têm interface de TV em forma de site (ela só roda em aparelho
certificado), então aqui eles abrem o site normal, navegado por controle.

## Teste

`python tests/smoke.py` abre o Firefox sem janela, percorre tela inicial, Wikipédia e YouTube TV
e salva prints em `tests/out/`. `python tests/pip_test.py` confere o picture-in-picture pelo
lançador de verdade.
