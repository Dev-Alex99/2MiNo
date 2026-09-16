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

      case 'ring':
        // Timbre de llamada entrante. Una ráfaga; la repetición cada 2,4 s la
        // gobierna iniciarTimbre(), que es quien sabe cuándo dejar de sonar.
        playRingBurst(ctx, now);
        break;

      case 'capicua':
        playCapicuaFanfare(ctx, now);
        break;

      case 'uno_call':
        playUnoCall(ctx, now);
        break;

      case 'uno_penalty':
        playUnoPenalty(ctx, now);
        break;

      default:
        break;
    }
  } catch (e) {
    console.warn('Web Audio no soportado o bloqueado por política de usuario:', e);
  }
}

/* ─────────────────────────────────────────────── el timbre de la línea */

// Bitono de teléfono: dos notas alternas, 180 ms sonando y 120 en silencio,
// cuatro repeticiones por ráfaga. Es el patrón que el oído reconoce como una
// llamada y no como un aviso del juego, que es exactamente lo que hace falta
// para que se distinga de los diez sonidos que ya suenan en la partida.
const TIMBRE_AGUDA = 880;
const TIMBRE_GRAVE = 660;
const TIMBRE_ON = 0.18;
const TIMBRE_OFF = 0.12;
const TIMBRE_REPETICIONES = 4;
const TIMBRE_GANANCIA = 0.18;

/** Cada cuánto se repite la ráfaga mientras el teléfono sigue sonando. */
const TIMBRE_CADA_MS = 2400;
/** Tope duro: 30 s es lo que el servidor mantiene viva la llamada. Pasado eso
 *  el timbre suena para nadie, y un teléfono que no para es una avería. */
const TIMBRE_TOPE_MS = 30000;

let timbreIntervalo = null;
let timbreParada = null;

function playRingBurst(ctx, time) {
  for (let i = 0; i < TIMBRE_REPETICIONES; i++) {
    const inicio = time + i * (TIMBRE_ON + TIMBRE_OFF);
    const freq = i % 2 === 0 ? TIMBRE_GRAVE : TIMBRE_AGUDA;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, inicio);

    // Rampas cortas en los dos extremos: un tono que arranca y para en seco
    // chasquea, y el chasquido se oye más que la nota.
    gainNode.gain.setValueAtTime(0.0001, inicio);
    gainNode.gain.linearRampToValueAtTime(TIMBRE_GANANCIA, inicio + 0.015);
    gainNode.gain.setValueAtTime(TIMBRE_GANANCIA, inicio + TIMBRE_ON - 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, inicio + TIMBRE_ON);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.onended = () => {
      try { osc.disconnect(); gainNode.disconnect(); } catch { /* ya desconectado */ }
    };

    osc.start(inicio);
    osc.stop(inicio + TIMBRE_ON + 0.02);
  }
}

/**
 * Arranca el timbre y lo mantiene hasta que alguien lo pare o venza el tope.
 *
 * IDEMPOTENTE: llamarlo dos veces con el mismo timbre sonando no lo duplica. Con
 * dos llamadas en espera sonaría el doble de fuerte y desfasado, que es la
 * versión sonora de pintar la tarjeta de llamada tres veces.
 *
 * Respeta el `isMuted` global —el mismo interruptor que apaga el resto del
 * juego— porque `playGameSound` lo comprueba en su primera línea. Y no arranca
 * ningún AudioContext propio: si el navegador todavía no ha desbloqueado el
 * audio, el timbre sale mudo y por eso hay otros dos canales (vibración y
 * parpadeo del título) que no dependen de un gesto previo.
 */
export function iniciarTimbre() {
  if (timbreIntervalo) return;
  playGameSound('ring');
  timbreIntervalo = setInterval(() => playGameSound('ring'), TIMBRE_CADA_MS);
  timbreParada = setTimeout(pararTimbre, TIMBRE_TOPE_MS);
}

export function pararTimbre() {
  if (timbreIntervalo) { clearInterval(timbreIntervalo); timbreIntervalo = null; }
  if (timbreParada) { clearTimeout(timbreParada); timbreParada = null; }
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

function playCapicuaFanfare(ctx, time) {
  // Arpegio doble ascendente + acorde triunfal con campana
  const arpegio1 = [523.25, 659.25, 783.99, 1046.50]; // Do5, Mi5, Sol5, Do6
  arpegio1.forEach((freq, idx) => {
    const t = time + idx * 0.08;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.36);
  });

  // Acorde final brillante
  const acorde = [523.25, 659.25, 783.99, 1046.50, 1318.51];
  const tFinal = time + 0.36;
  acorde.forEach((freq) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, tFinal);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2800, tFinal);
    filter.frequency.exponentialRampToValueAtTime(600, tFinal + 1.2);

    gain.gain.setValueAtTime(0.12, tFinal);
    gain.gain.exponentialRampToValueAtTime(0.001, tFinal + 1.2);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(tFinal);
    osc.stop(tFinal + 1.25);
  });
}

function playUnoCall(ctx, time) {
  // Toque vibrante de dos tonos ascendentes y brillantes (Fa5 -> Do6)
  const notas = [
    { freq: 698.46, dur: 0.12, offset: 0 },
    { freq: 1046.50, dur: 0.38, offset: 0.11 }
  ];

  notas.forEach(({ freq, dur, offset }) => {
    const t = time + offset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);

    // Armónico para darle carácter
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(freq * 1.5, t);

    gain.gain.setValueAtTime(0.16, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + dur + 0.02);
    osc2.start(t);
    osc2.stop(t + dur + 0.02);
  });
}

function playUnoPenalty(ctx, time) {
  // Tono disonante/descendente indicando penalización (340 Hz -> 170 Hz)
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(340, time);
  osc.frequency.exponentialRampToValueAtTime(160, time + 0.45);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(600, time);

  gain.gain.setValueAtTime(0.15, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.48);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start(time);
  osc.stop(time + 0.5);
}

