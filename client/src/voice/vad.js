/**
 * Detección de actividad de voz (VAD).
 *
 * `PlayerSeats` y `VideoGrid` llevaban desde siempre pintando un indicador de
 * "está hablando" a partir de `voice.speaking`, pero ese objeto nunca se
 * rellenaba: el cliente sólo emitía su estado al pulsar silenciar, nadie
 * escuchaba la respuesta y el indicador jamás se encendía.
 *
 * Aquí vive la parte decidible sin navegador —convertir muestras de audio en
 * "habla / no habla"— para poder probarla. El acceso al micrófono y el envío por
 * socket quedan en `useVoiceChat`.
 */

// Entrar a "hablando" exige más energía que mantenerse: sin esa histéresis, una
// voz que fluctúa alrededor del umbral haría parpadear el indicador.
export const VAD_UMBRAL_ENTRADA = 0.045;
export const VAD_UMBRAL_SALIDA = 0.02;
// Silencio sostenido antes de apagar. Las pausas entre palabras son de ~200 ms;
// con menos, el indicador se apagaría a media frase.
export const VAD_MS_SILENCIO = 400;

/**
 * Energía (RMS) de un bloque de muestras en el dominio del tiempo, tal y como
 * las entrega `AnalyserNode.getByteTimeDomainData`: enteros 0..255 centrados
 * en 128. Devuelve 0 (silencio absoluto) .. ~1 (saturación).
 */
export function rmsDe(muestras) {
  if (!muestras || !muestras.length) return 0;
  let suma = 0;
  for (let i = 0; i < muestras.length; i++) {
    const v = (muestras[i] - 128) / 128;
    suma += v * v;
  }
  return Math.sqrt(suma / muestras.length);
}

/**
 * Detector con histéresis y tiempo de retención.
 *
 * `procesar(rms, ahora)` devuelve:
 *   true  → acaba de EMPEZAR a hablar
 *   false → acaba de DEJAR de hablar
 *   null  → sin cambio (no hay que emitir nada)
 *
 * Devolver sólo los cambios es lo que evita inundar el socket: se manda un
 * evento por transición, no uno por muestra.
 */
export function crearDetector({
  entrada = VAD_UMBRAL_ENTRADA,
  salida = VAD_UMBRAL_SALIDA,
  msSilencio = VAD_MS_SILENCIO
} = {}) {
  let hablando = false;
  let ultimoSonido = 0;

  return {
    procesar(rms, ahora) {
      if (hablando) {
        if (rms > salida) {
          ultimoSonido = ahora;
          return null;
        }
        if (ahora - ultimoSonido >= msSilencio) {
          hablando = false;
          return false;
        }
        return null;
      }

      if (rms >= entrada) {
        hablando = true;
        ultimoSonido = ahora;
        return true;
      }
      return null;
    },

    /** Fuerza el apagado (al silenciar el micro o colgar). */
    reiniciar() {
      const estaba = hablando;
      hablando = false;
      ultimoSonido = 0;
      return estaba;
    },

    get hablando() { return hablando; }
  };
}
