import { describe, it, expect } from 'vitest';
import { rmsDe, crearDetector, VAD_UMBRAL_ENTRADA, VAD_UMBRAL_SALIDA, VAD_MS_SILENCIO } from './vad';

// Genera un bloque de muestras (0..255, centradas en 128) con una amplitud dada.
function bloque(amplitud, n = 128) {
  return Uint8Array.from({ length: n }, (_, i) => 128 + Math.round(Math.sin(i / 4) * amplitud * 127));
}

describe('vad · rmsDe', () => {
  it('el silencio absoluto da 0', () => {
    expect(rmsDe(new Uint8Array(128).fill(128))).toBe(0);
  });

  it('crece con la amplitud', () => {
    const flojo = rmsDe(bloque(0.05));
    const fuerte = rmsDe(bloque(0.8));
    expect(fuerte).toBeGreaterThan(flojo);
    expect(flojo).toBeGreaterThan(0);
  });

  it('nunca pasa de ~1 ni con saturación', () => {
    expect(rmsDe(bloque(1))).toBeLessThanOrEqual(1.01);
  });

  it('no revienta con entrada vacía', () => {
    expect(rmsDe(new Uint8Array(0))).toBe(0);
    expect(rmsDe(null)).toBe(0);
  });
});

describe('vad · detector', () => {
  it('el silencio no dispara nada', () => {
    const d = crearDetector();
    expect(d.procesar(0, 0)).toBeNull();
    expect(d.procesar(0.001, 100)).toBeNull();
    expect(d.hablando).toBe(false);
  });

  it('al superar el umbral avisa UNA vez de que empieza a hablar', () => {
    const d = crearDetector();
    expect(d.procesar(VAD_UMBRAL_ENTRADA + 0.01, 0)).toBe(true);
    // Mientras siga hablando no se vuelve a emitir: sólo interesan los cambios.
    expect(d.procesar(0.5, 50)).toBeNull();
    expect(d.procesar(0.5, 100)).toBeNull();
    expect(d.hablando).toBe(true);
  });

  /**
   * Histéresis: sin ella, una voz que fluctúa alrededor del umbral haría
   * parpadear el indicador varias veces por segundo.
   */
  it('un nivel entre los dos umbrales MANTIENE el estado, no lo apaga', () => {
    const d = crearDetector();
    d.procesar(0.2, 0); // empieza a hablar
    const intermedio = (VAD_UMBRAL_ENTRADA + VAD_UMBRAL_SALIDA) / 2;
    expect(d.procesar(intermedio, 100)).toBeNull();
    expect(d.hablando).toBe(true);
  });

  it('ese mismo nivel intermedio NO habría bastado para empezar a hablar', () => {
    const d = crearDetector();
    const intermedio = (VAD_UMBRAL_ENTRADA + VAD_UMBRAL_SALIDA) / 2;
    expect(d.procesar(intermedio, 0)).toBeNull();
    expect(d.hablando).toBe(false);
  });

  /**
   * Tiempo de retención: las pausas entre palabras son de ~200 ms. Sin él, el
   * indicador se apagaría a media frase.
   */
  it('una pausa corta entre palabras no apaga el indicador', () => {
    const d = crearDetector();
    d.procesar(0.2, 0);
    expect(d.procesar(0, 200)).toBeNull(); // pausa de 200 ms
    expect(d.hablando).toBe(true);
    expect(d.procesar(0.2, 250)).toBeNull(); // sigue hablando
  });

  it('un silencio sostenido sí lo apaga, y avisa UNA vez', () => {
    const d = crearDetector();
    d.procesar(0.2, 0);
    expect(d.procesar(0, VAD_MS_SILENCIO + 1)).toBe(false);
    expect(d.hablando).toBe(false);
    // Ya apagado, el silencio no vuelve a emitir.
    expect(d.procesar(0, VAD_MS_SILENCIO + 500)).toBeNull();
  });

  it('un turno de palabra completo produce exactamente dos eventos', () => {
    const d = crearDetector();
    const cambios = [];
    const muestrear = (rms, t) => {
      const r = d.procesar(rms, t);
      if (r !== null) cambios.push(r);
    };

    let t = 0;
    for (let i = 0; i < 20; i++) muestrear(0.3, t += 50);   // habla 1 s
    for (let i = 0; i < 20; i++) muestrear(0.001, t += 50); // calla 1 s

    expect(cambios).toEqual([true, false]);
  });

  it('reiniciar apaga y dice si estaba encendido (al silenciar el micro)', () => {
    const d = crearDetector();
    d.procesar(0.2, 0);
    expect(d.reiniciar()).toBe(true);
    expect(d.hablando).toBe(false);
    expect(d.reiniciar()).toBe(false); // ya estaba apagado
  });

  it('los umbrales son configurables', () => {
    const d = crearDetector({ entrada: 0.5, salida: 0.4, msSilencio: 10 });
    expect(d.procesar(0.45, 0)).toBeNull(); // no llega al umbral de entrada
    expect(d.procesar(0.6, 10)).toBe(true);
  });
});
