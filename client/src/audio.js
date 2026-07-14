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

      case 'draw':
        // Raspado suave de la ficha al arrastrarla
        playScrape(ctx, now);
        break;

      case 'pass':
        // Golpe apagado tipo madera (toc-toc)
        playWoodKnock(ctx, now, 250);
        playWoodKnock(ctx, now + 0.15, 200);
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
      
      default:
        break;
    }
  } catch (e) {
    console.warn('Web Audio no soportado o bloqueado por política de usuario:', e);
  }
}

// Genera un golpe agudo de dominó (clac)
function playClack(ctx, time, volume, frequency) {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(frequency, time);
  // Pequeña modulación rápida del tono para simular resonancia
  osc.frequency.exponentialRampToValueAtTime(100, time + 0.04);

  gainNode.gain.setValueAtTime(volume * 0.4, time);
  gainNode.gain.exponentialRampToValueAtTime(0.01, time + 0.05);

  // Filtro pasa banda para dar un sonido más hueco y plástico
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(frequency * 0.8, time);
  filter.Q.setValueAtTime(4, time);

  osc.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(ctx.destination);

  osc.start(time);
  osc.stop(time + 0.06);
}

// Genera un sonido de raspado al robar (scrape)
function playScrape(ctx, time) {
  const bufferSize = ctx.sampleRate * 0.25; // 0.25 segundos
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  
  // Generar ruido blanco
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noiseNode = ctx.createBufferSource();
  noiseNode.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(600, time);
  // Variar la frecuencia del filtro para simular arrastre
  filter.frequency.exponentialRampToValueAtTime(250, time + 0.25);
  filter.Q.setValueAtTime(2, time);

  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(0.08, time);
  gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.25);

  noiseNode.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(ctx.destination);

  noiseNode.start(time);
  noiseNode.stop(time + 0.26);
}

// Sonido sordo de golpe en madera o plástico pesado (para el paso)
function playWoodKnock(ctx, time, freq) {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, time);
  osc.frequency.exponentialRampToValueAtTime(80, time + 0.08);

  gainNode.gain.setValueAtTime(0.3, time);
  gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.1);

  osc.connect(gainNode);
  gainNode.connect(ctx.destination);

  osc.start(time);
  osc.stop(time + 0.11);
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
