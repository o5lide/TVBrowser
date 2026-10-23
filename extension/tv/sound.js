// Sons da interface, sintetizados na hora (Web Audio): não há arquivo de áudio no projeto.
// Roda só no background: um contexto de áudio para o navegador todo, fora da página do site.
TV.sound = (() => {
  let ctx = null, master = null, noise = null;
  let muted = false, booted = false;

  function setup() {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);
    // meio segundo de ruído branco, matéria-prima dos "sopros" de abrir e fechar
    noise = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }

  // Volume que sobe num estalo e morre até o fim: é o que dá o caráter de "blip".
  function envelope(amp, start, length, gain, attack = 0.006) {
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + length);
  }

  // Uma nota: oscilador deslizando de `from` até `to`.
  function note({ type = 'triangle', from, to = from, at = 0, length = 0.08, gain = 0.3 }) {
    const start = ctx.currentTime + at;
    const osc = ctx.createOscillator(), amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(to, start + length);
    envelope(amp, start, length, gain);
    osc.connect(amp).connect(master);
    osc.start(start);
    osc.stop(start + length + 0.02);
  }

  // Um sopro: ruído por um filtro que varre de `from` até `to`.
  function whoosh({ from, to, at = 0, length = 0.18, gain = 0.2 }) {
    const start = ctx.currentTime + at;
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), amp = ctx.createGain();
    source.buffer = noise;
    source.loop = true;
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(to, start + length);
    envelope(amp, start, length, gain, length * 0.3);
    source.connect(filter).connect(amp).connect(master);
    source.start(start);
    source.stop(start + length + 0.02);
  }

  const SOUNDS = {
    // foco andando pela página, pelo menu e pelo teclado virtual
    move: () => note({ from: 880, to: 700, length: 0.05, gain: 0.22 }),
    // a roda da tela inicial girando: mais grave e subindo, com um estalinho por cima
    wheel: () => {
      note({ type: 'sine', from: 420, to: 640, length: 0.09, gain: 0.3 });
      note({ type: 'square', from: 1260, length: 0.025, gain: 0.05 });
    },
    key: () => note({ type: 'square', from: 1500, to: 1100, length: 0.03, gain: 0.07 }),
    // confirmar: duas notas subindo uma quinta, com um brilho uma oitava acima
    select: () => {
      note({ from: 660, length: 0.09, gain: 0.3 });
      note({ from: 990, at: 0.07, length: 0.14, gain: 0.3 });
      note({ type: 'sine', from: 1980, at: 0.07, length: 0.2, gain: 0.08 });
    },
    // voltar: o mesmo gesto, descendo
    back: () => {
      note({ from: 620, length: 0.08, gain: 0.26 });
      note({ from: 415, at: 0.07, length: 0.14, gain: 0.26 });
    },
    open: () => {
      whoosh({ from: 400, to: 3200 });
      note({ type: 'sine', from: 330, to: 660, length: 0.16, gain: 0.2 });
    },
    close: () => {
      whoosh({ from: 3200, to: 400 });
      note({ type: 'sine', from: 660, to: 330, length: 0.16, gain: 0.2 });
    },
    // "não dá": dois toques graves
    deny: () => {
      note({ type: 'sawtooth', from: 150, to: 110, length: 0.14, gain: 0.16 });
      note({ type: 'sawtooth', from: 150, to: 110, at: 0.13, length: 0.14, gain: 0.16 });
    },
    // abertura: quatro notas subindo com um sopro longo por baixo (só uma vez por sessão)
    boot: () => {
      [262, 392, 523, 784].forEach((from, i) => note({ type: 'sine', from, at: i * 0.11, length: 0.55, gain: 0.22 }));
      whoosh({ from: 200, to: 5000, length: 0.7, gain: 0.1 });
    },
  };

  function play(name) {
    if (muted || !SOUNDS[name]) return 'mudo';
    if (name === 'boot') {
      if (booted) return 'já tocou';
      booted = true;
    }
    if (!ctx) setup();
    if (ctx.state === 'suspended') ctx.resume();
    SOUNDS[name]();
    return ctx.state;
  }

  if (TV.api) {
    TV.api.storage.local.get('muted').then((stored) => { muted = Boolean(stored.muted); });
    TV.api.storage.onChanged.addListener((changes) => {
      if (changes.muted) muted = Boolean(changes.muted.newValue);
    });
  }

  return { play };
})();
