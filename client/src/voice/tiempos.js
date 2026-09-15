/**
 * Los plazos de la línea, en un solo sitio.
 *
 * Estaban repartidos por `useVoiceChat` o simplemente no existían (el timbre no
 * caducaba en el cliente, un par sin ruta no se declaraba nunca). Tenerlos
 * juntos es lo que permite razonar sobre ellos como sistema: hay dos parejas que
 * SÓLO son correctas en relación con otro número, y eso no se ve si cada
 * constante vive junto a su `setTimeout`.
 */

/** Tope de espera al diálogo de permiso del navegador. Al vencer: micro_sin_respuesta. */
export const MIC_TOPE = 12000;

/**
 * Caducidad local del timbre saliente. MAYOR que los 30 s del servidor a
 * propósito: el servidor es la fuente de la verdad y su `call_timeout` debe
 * llegar antes; éste es la red por si ese mensaje se pierde.
 */
export const TIMBRE_LOCAL = 32000;

/** Un `restartIce()` gratuito antes de rendirse con un par. */
export const PAR_REINICIO_ICE = 6000;

/** Sin conectar pasado esto, el par se declara sin ruta — pero NO se cierra. */
export const PAR_SIN_RUTA = 15000;

/** En fallo sostenido, el par se da por ido y se destruye. */
export const PAR_CAIDO = 20000;

/**
 * Tope del reenganche tras perder el socket.
 *
 * ESTRICTAMENTE MENOR que el GRACIA_MS del servidor (30 s, server/voicePools.js):
 * si el cliente se rindiera después, el servidor ya habría soltado la sesión y
 * el reenganche encontraría un pool que ya no existe. Ajustar uno de los dos
 * sin mirar el otro rompe el reenganche en silencio.
 */
export const RECUPERANDO_TOPE = 25000;

/** Lo que se queda en pantalla el resumen de una llamada terminada. */
export const CERRADA_VISIBLE = 4000;

/** Cadencia del muestreo de calidad por par (getStats). */
export const MUESTREO_CALIDAD = 2000;

/* ─────────────────────────────────────────────────────────────────────────────
   Añadidos sobre los ocho del contrato. Van aquí y no junto a su uso por la
   misma razón que los de arriba: son plazos, y los plazos se comparan entre sí.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Estrangulamiento de `voice_peer_state`: como mucho un diagnóstico por segundo
 * y por pareja. Sin él, un par que parpadea entre 'inestable' y 'enlazado_justo'
 * convertiría el socket en un chorro.
 */
export const PAR_ESTADO_MINIMO = 1000;

/** Cadencia del muestreo del micro para el VAD y para el medidor de nivel. */
export const VAD_MUESTREO = 100;

/**
 * Cada cuánto se recalcula la descripción hablada del medidor («sin señal»,
 * «señal débil», «señal correcta»). Estable, no continua: un medidor que se
 * anuncie diez veces por segundo es peor que ninguno.
 */
export const NIVEL_PALABRA = 2000;
