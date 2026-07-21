// Audio Synthesizer utilizando Web Audio API para simular sonidos de fichas de dominó
// Optimizado para no descargar archivos de audio (cero ancho de banda).

let audioCtx = null;
let isMuted = false;

function initAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function toggleMute() {
  isMuted = !isMuted;
  return isMuted;
}

export function getMuteState() {
  return isMuted;
}

export function playGameSound(type) {
  if (isMuted) return;

  try {
    const ctx = initAudioContext();
    const now = ctx.currentTime;

    switch (type) {
      case 'place':
        // Doble contacto característico del dominó (clac-clac)
        playClack(ctx, now, 1.0, 1000);
        playClack(ctx, now + 0.05, 0.7, 850);
        break;

      case 'double_place':
        // Gran impacto de ficha doble ("¡Traz!"): clac pesado + resonancia de madera
        playClack(ctx, now, 1.3, 1250);
        playClack(ctx, now + 0.04, 0.95, 980);
        playWoodKnock(ctx, now, 180, 0.6);
        break;

      case 'draw':
        // Raspado suave de la ficha al arrastrarla
        playScrape(ctx, now);
        break;

      case 'pass':
        // Dos toques de nudillos en la mesa de madera (toc-toc hiperrealista)
        playWoodKnock(ctx, now, 240, 0.48);
        playWoodKnock(ctx, now + 0.13, 195, 0.42);
        break;

      case 'shuffle':
        // Varios choques aleatorios simulando el barajado de fichas
        for (let i = 0; i < 8; i++) {
          const delay = i * 0.08 + Math.random() * 0.04;
          const pitch = 800 + Math.random() * 400;
          const vol = 0.3 + Math.random() * 0.4;
          playClack(ctx, now + delay, vol, pitch);
        }
        break;

      case 'win_round':
        // Arpegio ascendente de campanas
        playBellArpeggio(ctx, now);
        break;

      case 'win_game':
        // Acorde triunfal
        playVictoryChime(ctx, now);
        break;
      
      case 'power':
        playPowerSynth(ctx, now);
        break;

      case 'epic':
        // Golpe cinematográfico: impacto grave + barrido ascendente + acorde brillante.
        playEpicSting(ctx, now);
        break;

      case 'turn_alert':
        playTurnChime(ctx, now);
        break;

      default:
        break;
    }
  } catch (e) {
    console.warn('Web Audio no soportado o bloqueado por política de usuario:', e);
  }
}

// Alerta sonora doble (Do5 - Sol5) de aviso de turno
function playTurnChime(ctx, time) {
  const notes = [523.25, 783.99];
  notes.forEach((freq, index) => {
    const noteTime = time + index * 0.08;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, noteTime);

    gainNode.gain.setValueAtTime(0.0, noteTime);
    gainNode.gain.linearRampToValueAtTime(0.2, noteTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.35);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.onended = () => {
      try { osc.disconnect(); gainNode.disconnect(); } catch {}
    };

    osc.start(noteTime);
    osc.stop(noteTime + 0.4);
  });
}

// Genera un golpe agudo de dominó (clac)
function playClack(ctx, time, volume, frequency) {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(frequency, time);
  osc.frequency.exponentialRampToValueAtTime(100, time + 0.04);

  gainNode.gain.setValueAtTime(volume * 0.4, time);
  gainNode.gain.exponentialRampToValueAtTime(0.01, time + 0.05);

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(frequency * 0.8, time);
  filter.Q.setValueAtTime(4, time);

  osc.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(ctx.destination);

  osc.onended = () => {
    try { osc.disconnect(); filter.disconnect(); gainNode.disconnect(); } catch {}
  };

  osc.start(time);
  osc.stop(time + 0.06);
}

// Cache global del buffer de ruido para playScrape (previene 12,000 asignaciones por robo de ficha)
let cachedScrapeBuffer = null;

function getScrapeBuffer(ctx) {
  if (cachedScrapeBuffer && cachedScrapeBuffer.sampleRate === ctx.sampleRate) {
    return cachedScrapeBuffer;
  }
  const bufferSize = Math.floor(ctx.sampleRate * 0.22);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  cachedScrapeBuffer = buffer;
  return buffer;
}

// Genera un sonido de raspado al robar (scrape)
function playScrape(ctx, time) {
  const buffer = getScrapeBuffer(ctx);
  const noiseNode = ctx.createBufferSource();
  noiseNode.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(600, time);
  filter.frequency.exponentialRampToValueAtTime(250, time + 0.25);
  filter.Q.setValueAtTime(2, time);

  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(0.08, time);
  gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.25);

  noiseNode.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(ctx.destination);

  noiseNode.onended = () => {
    try { noiseNode.disconnect(); filter.disconnect(); gainNode.disconnect(); } catch {}
  };

  noiseNode.start(time);
  noiseNode.stop(time + 0.26);
}

// Sonido realista de golpe con nudillos sobre mesa de madera (para el paso de turno)
function playWoodKnock(ctx, time, freq, vol = 0.35) {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, time);
  osc.frequency.exponentialRampToValueAtTime(70, time + 0.08);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(500, time);
  filter.Q.setValueAtTime(2.5, time);

  gainNode.gain.setValueAtTime(vol, time);
  gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.09);

  osc.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(ctx.destination);

  osc.onended = () => {
    try { osc.disconnect(); filter.disconnect(); gainNode.disconnect(); } catch {}
  };

  osc.start(time);
  osc.stop(time + 0.1);
}

// Sonido feliz para finalizar ronda
function playBellArpeggio(ctx, time) {
  const notes = [261.63, 329.63, 392.00, 523.25]; // Do, Mi, Sol, Do
  notes.forEach((freq, index) => {
    const noteTime = time + index * 0.08;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, noteTime);

    gainNode.gain.setValueAtTime(0.0, noteTime);
    gainNode.gain.linearRampToValueAtTime(0.15, noteTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.4);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(noteTime);
    osc.stop(noteTime + 0.45);
  });
}

// Campanas triunfales al ganar la partida completa
function playVictoryChime(ctx, time) {
  const chords = [
    [261.63, 329.63, 392.00], // Do mayor
    [349.23, 440.00, 523.25], // Fa mayor
    [392.00, 493.88, 587.33], // Sol mayor
    [523.25, 659.25, 783.99, 1046.50] // Do mayor octava alta
  ];

  chords.forEach((chord, chordIndex) => {
    const chordTime = time + chordIndex * 0.25;
    const duration = chordIndex === 3 ? 1.0 : 0.4;
    const vol = chordIndex === 3 ? 0.15 : 0.08;

    chord.forEach(freq => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, chordTime);

      gainNode.gain.setValueAtTime(0, chordTime);
      gainNode.gain.linearRampToValueAtTime(vol, chordTime + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.001, chordTime + duration);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(chordTime);
      osc.stop(chordTime + duration + 0.05);
    });
  });
}

// "Sting" épico para momentos grandes (dominó, tranca, poder legendario, victoria).
function playEpicSting(ctx, time) {
  // 1) Impacto grave (boom)
  const boom = ctx.createOscillator();
  const boomGain = ctx.createGain();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(120, time);
  boom.frequency.exponentialRampToValueAtTime(45, time + 0.5);
  boomGain.gain.setValueAtTime(0.0001, time);
  boomGain.gain.exponentialRampToValueAtTime(0.5, time + 0.02);
  boomGain.gain.exponentialRampToValueAtTime(0.001, time + 0.7);
  boom.connect(boomGain);
  boomGain.connect(ctx.destination);
  boom.start(time);
  boom.stop(time + 0.75);

  // 2) Barrido ascendente (riser)
  const riser = ctx.createOscillator();
  const riserGain = ctx.createGain();
  const riserFilter = ctx.createBiquadFilter();
  riser.type = 'sawtooth';
  riser.frequency.setValueAtTime(200, time);
  riser.frequency.exponentialRampToValueAtTime(1600, time + 0.6);
  riserFilter.type = 'lowpass';
  riserFilter.frequency.setValueAtTime(500, time);
  riserFilter.frequency.exponentialRampToValueAtTime(3000, time + 0.6);
  riserGain.gain.setValueAtTime(0.0001, time);
  riserGain.gain.linearRampToValueAtTime(0.12, time + 0.5);
  riserGain.gain.exponentialRampToValueAtTime(0.001, time + 0.75);
  riser.connect(riserFilter);
  riserFilter.connect(riserGain);
  riserGain.connect(ctx.destination);
  riser.start(time);
  riser.stop(time + 0.78);

  // 3) Acorde brillante al caer el impacto (shimmer)
  const chord = [523.25, 659.25, 783.99, 1046.50];
  chord.forEach(freq => {
    const t2 = time + 0.55;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t2);
    g.gain.setValueAtTime(0, t2);
    g.gain.linearRampToValueAtTime(0.09, t2 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t2 + 1.1);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t2);
    o.stop(t2 + 1.15);
  });
}

function playPowerSynth(ctx, time) {
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  osc1.type = 'sawtooth';
  osc1.frequency.setValueAtTime(150, time);
  osc1.frequency.exponentialRampToValueAtTime(1000, time + 0.6);

  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(300, time);
  osc2.frequency.exponentialRampToValueAtTime(2000, time + 0.6);

  gain.gain.setValueAtTime(0.12, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.65);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(800, time);
  filter.frequency.exponentialRampToValueAtTime(2500, time + 0.5);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc1.start(time);
  osc1.stop(time + 0.65);
  osc2.start(time);
  osc2.stop(time + 0.65);
}
