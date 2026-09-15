/**
 * La máquina de estados de la línea. Función PURA: ni React, ni navegador, ni
 * reloj propio (la marca de tiempo llega dentro del suceso).
 *
 * Existe porque el estado anterior mentía. `acceptCall` ponía 'connected' antes
 * de que hubiera una sola RTCPeerConnection, y el widget tenía que compensarlo
 * con una heurística — `callState==='connected' || (memberCount>1 && …)` — que
 * es exactamente la firma de un estado en el que su dueño no confía. Aquí
 * `abierta` EXIGE que algún par esté enlazado, y enlazado exige bytes de audio
 * entrando (ver calidad.js).
 *
 * El reductor devuelve `{ linea, efectos }`. Los efectos son DATOS, no llamadas:
 * `{ tipo:'emitir', evento, payload }`, `{ tipo:'pedirMicro' }`, `{ tipo:'aviso' }`,
 * `{ tipo:'reiniciarIce' }`. Así lo que la máquina manda por el socket se puede
 * afirmar en un test sin socket, que es la mitad de lo que no estaba cubierto.
 */

export const ESTADOS = [
  'inactiva', 'pidiendoMicro', 'saliente', 'entrante', 'enlazando',
  'abierta', 'fragil', 'sinRuta', 'recuperando', 'cerrada'
];

export const MOTIVOS = [
  'colgado_por_mi', 'colgado_por_el_otro', 'rechazada', 'sin_respuesta',
  'cancelada_por_mi', 'cancelada_por_el_otro', 'atendida_en_otra_pestana',
  'amigo_desconectado', 'no_molestar', 'enfriamiento', 'no_amigos',
  'sesion_no_verificada', 'sesion_perdida',
  'micro_bloqueado', 'micro_ausente', 'micro_ocupado', 'micro_desaparecido',
  'micro_sin_respuesta', 'micro_desconocido',
  // Los dos códigos que el servidor emite y que la tabla del contrato no
  // enumera (los reportó P4-SRV al cerrar). Se atraviesan igual: dejarlos fuera
  // los convertiría en un silencio, que es el defecto que este paquete cierra.
  //
  // COPY PENDIENTE, y es lo único de esta máquina que no está traducido: hacen
  // falta 'linea.lineaLlena' y 'linea.yaEnLinea' en es/pt/en (los pide P0-I18N,
  // ya está en su lista de pendientes porque P4 lo reportó). Hasta que existan,
  // quien las pinte verá la clave cruda. Se emiten igual a propósito: un aviso
  // feo es recuperable en tres líneas de diccionario; un silencio, no.
  'linea_llena', 'ya_en_linea'
];

/** `call_error.code` → motivo de cierre. Lo que no está aquí se descarta. */
export const MOTIVO_DE_CODIGO = {
  no_verificado: 'sesion_no_verificada',
  desconectado: 'amigo_desconectado',
  no_molestar: 'no_molestar',
  enfriamiento: 'enfriamiento',
  no_amigos: 'no_amigos',
  no_existe: 'colgado_por_el_otro',
  linea_llena: 'linea_llena',
  ya_en_linea: 'ya_en_linea'
  // `no_miembro` y `a_ti_mismo` NO están: el contrato §5.3 los manda descartar
  // en silencio. Son fallos de programación nuestros, no cosas que contarle a
  // quien está intentando llamar.
};

/**
 * Motivo de cierre → clave i18n del resumen. La tabla vive aquí, junto a la
 * lista de motivos, para que quien pinte el resumen NO tenga que inventarse los
 * nombres de las claves: `t()` devuelve la clave cruda cuando no la encuentra,
 * así que un nombre inventado es texto de programador en pantalla.
 *
 * Los `micro_*` NO están a propósito: su clave la trae ya el propio fallo en
 * `micError.clave`, que la pone `mediosLocales.js` — el módulo que conoce la
 * taxonomía de errores del navegador. Duplicar seis entradas aquí sólo serviría
 * para que las dos tablas discrepasen dentro de un mes.
 *
 * DOS CLAVES DE ESTA TABLA NO EXISTEN TODAVÍA en el diccionario:
 * `linea.lineaLlena` y `linea.yaEnLinea` (las pide P0-I18N; P4-SRV ya reportó
 * que sus dos códigos necesitaban copy). Están escritas con el nombre definitivo
 * para que declararlas sea lo único que falte.
 */
export const CLAVE_DE_CIERRE = {
  colgado_por_mi: 'linea.colgada',
  cancelada_por_mi: 'linea.colgada',
  colgado_por_el_otro: 'linea.colgoElOtro',
  cancelada_por_el_otro: 'linea.canceladaPorElOtro',
  rechazada: 'linea.rechazada',
  sin_respuesta: 'linea.sinRespuesta',
  atendida_en_otra_pestana: 'linea.atendidaEnOtraPestana',
  amigo_desconectado: 'linea.amigoDesconectado',
  no_molestar: 'linea.noMolestar',
  enfriamiento: 'linea.enfriamiento',
  no_amigos: 'linea.noAmigos',
  sesion_no_verificada: 'linea.sesionNoVerificada',
  sesion_perdida: 'linea.sesionPerdida',
  linea_llena: 'linea.lineaLlena',
  ya_en_linea: 'linea.yaEnLinea'
};

/**
 * Los `call_error.code` que, con la línea YA ABIERTA, informan en vez de colgar.
 *
 * Un error que llega con la conversación en marcha es siempre la respuesta a una
 * acción LATERAL —invitar a alguien, pedir entrar en la voz de la mesa—, nunca a
 * la llamada en curso, que el servidor ya no tocaría. Colgar por el botón que
 * pulsó uno de los dos castigaría al otro, que se estaba oyendo perfectamente.
 *
 * `no_existe` NO está, y es deliberado: su copy («Han colgado») sería falsa aquí
 * —significa «esa sala o esa llamada ya no existe», no que nadie haya colgado— y
 * una traza que miente es peor que ninguna. Se descarta en silencio.
 */
const AVISO_CON_LINEA_VIVA = {
  linea_llena: 'linea.lineaLlena',
  ya_en_linea: 'linea.yaEnLinea',
  enfriamiento: 'linea.enfriamiento',
  no_molestar: 'linea.noMolestar',
  no_amigos: 'linea.noAmigos',
  desconectado: 'linea.amigoDesconectado',
  no_verificado: 'linea.sesionNoVerificada'
};

/** `voice_pool_left.motivo` → motivo de cierre. */
const MOTIVO_DE_SALIDA = {
  colgado_por_mi: 'colgado_por_mi',
  linea_vacia: 'colgado_por_el_otro',
  fuera_de_la_mesa: 'colgado_por_mi'
};

/** Los estados en los que hay una llamada viva que mantener. */
export const EN_LLAMADA = ['enlazando', 'abierta', 'fragil', 'sinRuta', 'recuperando'];

/** Los estados en los que ya hay micrófono abierto. */
export const CON_MICRO = ['saliente', ...EN_LLAMADA];

export function lineaInicial() {
  return {
    estado: 'inactiva',
    motivo: null,
    /** Qué queríamos hacer cuando pedimos el micro. Sobrevive al await. */
    intencion: null,
    /** La llamada saliente en curso: { callId, targetPlayerId, targetName, expiraEn }. */
    saliente: null,
    /** El timbre que suena ahora: { callId, fromPlayerId, fromName, tipo, expiraEn }. */
    entrante: null,
    poolId: null,
    contexto: null,
    miembros: [],
    /** Otra pestaña de esta cuenta tiene la sesión de voz. */
    enOtraPestana: false,
    /** Timbres pendientes que anuncia `voice_state` (o los que llegan en llamada). */
    timbrando: [],
    /** Marca del último cambio de estado: de ahí salen las cuentas atrás. */
    desde: 0
  };
}

/**
 * Resumen de la malla, que es de lo que dependen cuatro transiciones globales.
 *
 * `conectados` cuenta SÓLO los `enlazado_*`, y eso es el punto crítico del
 * contrato: `enlazado_*` exige bytes de audio medidos (calidad.js), así que
 * `abierta` no se puede alcanzar sin que entre sonido de verdad.
 *
 * `inestable` va aparte y NO cuenta como enlazado, aunque en la mitad de los
 * casos haya audio: la otra mitad es el ICE en 'disconnected', donde no entra un
 * byte. Meterlo en `conectados` haría que un único par desconectado declarase
 * «Línea abierta», que es exactamente la mentira que esta máquina viene a
 * quitar. Tampoco se ignora —dejaría en «Enlazando…» a dos personas que se están
 * oyendo mal pero se oyen—: vale por `fragil`, que es la palabra honesta.
 */
export function resumenDePares(pares) {
  const estados = Object.values(pares || {}).filter(e => e !== 'ido');
  return {
    total: estados.length,
    conectados: estados.filter(e => e === 'enlazado_bien' || e === 'enlazado_justo').length,
    inestables: estados.filter(e => e === 'inestable').length,
    sinRuta: estados.filter(e => e === 'sin_ruta').length,
    ausentes: estados.filter(e => e === 'ausente').length
  };
}

function cerrar(linea, motivo, ahora) {
  return {
    ...linea,
    estado: 'cerrada',
    motivo,
    // La intención SOBREVIVE a un fallo de micrófono, y sólo a ése: es lo que
    // hace posible el botón [Entrar solo a escuchar] de la tarjeta de error.
    // Solo-escucha existe ÚNICAMENTE así, etiquetado y pulsado a propósito;
    // como consecuencia silenciosa de un fallo sería la versión educada del
    // bug de hoy — el teléfono del otro suena, contesta, y descubre que no
    // puedes hablarle.
    intencion: String(motivo).startsWith('micro_') ? linea.intencion : null,
    saliente: null,
    entrante: null,
    desde: ahora
  };
}

/** La emisión que corresponde a una intención ya resuelta (con micro o sin él). */
function cumplirIntencion(linea, intencion, ahora, emitir) {
  if (intencion.tipo === 'llamar') {
    emitir('call_friend', { targetPlayerId: intencion.a });
    return { ...linea, estado: 'saliente', intencion: null, motivo: null, desde: ahora };
  }
  if (intencion.tipo === 'aceptar') {
    emitir('accept_call', { callId: intencion.callId });
    return { ...linea, estado: 'enlazando', intencion: null, motivo: null, desde: ahora };
  }
  emitir('join_table_voice', {});
  return { ...linea, estado: 'enlazando', intencion: null, motivo: null, desde: ahora };
}

function aInactiva(linea, ahora) {
  return {
    ...lineaInicial(),
    // Lo que NO se olvida al volver al reposo: si otra pestaña tiene la sesión,
    // sigue teniéndola, y los timbres pendientes siguen pendientes.
    enOtraPestana: linea.enOtraPestana,
    timbrando: linea.timbrando,
    desde: ahora
  };
}

/**
 * A qué estado lleva un pool recién anunciado por el servidor.
 *
 * Con acompañantes, `enlazando`: hay pares que abrir y la calidad decidirá.
 * Solo en la voz de la MESA, `abierta`: no hay nada que enlazar y no va a llegar
 * ningún `pares` que saque de la espera. (Solo en una línea PRIVADA no pasa por
 * aquí: eso es que el otro colgó, y se cierra unas líneas más arriba.)
 */
function solo(contexto, miembros) {
  const esMesa = contexto && contexto.tipo === 'mesa';
  return esMesa && (miembros || []).length <= 1 ? 'abierta' : 'enlazando';
}

/** Quita un timbre de la cola de pendientes por su callId. */
function sinTimbre(timbrando, callId) {
  return (timbrando || []).filter(t => t.callId !== callId);
}

/**
 * @param {object} linea   estado actual (el de `lineaInicial()`)
 * @param {object} suceso  { tipo, ahora, ...datos }
 * @returns {{ linea: object, efectos: Array }}
 */
export function reducir(linea, suceso) {
  const ahora = suceso.ahora || 0;
  const efectos = [];
  const emitir = (evento, payload) => efectos.push({ tipo: 'emitir', evento, payload });
  const avisar = (key, params) => efectos.push({ tipo: 'aviso', key, params });
  const quieto = () => ({ linea, efectos });
  const con = (cambios) => ({ linea: { ...linea, ...cambios }, efectos });

  switch (suceso.tipo) {

    /* ─── Intenciones del jugador ─── */

    case 'llamar': {
      // Desde `cerrada` también: es el botón [Volver a llamar] del resumen.
      if (linea.estado !== 'inactiva' && linea.estado !== 'cerrada') return quieto();
      efectos.push({ tipo: 'pedirMicro' });
      return {
        linea: {
          ...aInactiva(linea, ahora),
          estado: 'pidiendoMicro',
          intencion: { tipo: 'llamar', a: suceso.a, nombre: suceso.nombre || '' },
          desde: ahora
        },
        efectos
      };
    }

    case 'entrarAMesa': {
      // Con la línea ya abierta NO se rehace el ciclo del micro: se pide entrar y
      // que conteste el servidor (`ya_en_linea` si toca). Rehacerlo tumbaría una
      // conversación en curso para preguntar algo que el servidor sabe.
      if (CON_MICRO.includes(linea.estado)) {
        emitir('join_table_voice', {});
        return quieto();
      }
      if (linea.estado !== 'inactiva' && linea.estado !== 'cerrada') return quieto();
      efectos.push({ tipo: 'pedirMicro' });
      return {
        linea: { ...aInactiva(linea, ahora), estado: 'pidiendoMicro', intencion: { tipo: 'mesa' }, desde: ahora },
        efectos
      };
    }

    case 'cambiarALaMesa': {
      // Salir de la línea privada y entrar en la de la mesa, en ese orden. El
      // servidor procesa los dos eventos en secuencia, así que no hay hueco en
      // el que la cuenta esté en dos pools.
      if (!CON_MICRO.includes(linea.estado)) return quieto();
      emitir('end_call', {});
      emitir('join_table_voice', {});
      return con({ estado: 'enlazando', motivo: null, miembros: [], desde: ahora });
    }

    case 'aceptar': {
      if (linea.estado !== 'entrante' || !linea.entrante) return quieto();
      efectos.push({ tipo: 'pedirMicro' });
      return con({
        estado: 'pidiendoMicro',
        intencion: {
          tipo: 'aceptar',
          callId: linea.entrante.callId,
          de: linea.entrante.fromPlayerId,
          nombre: linea.entrante.fromName
        },
        entrante: null,
        timbrando: sinTimbre(linea.timbrando, linea.entrante.callId),
        desde: ahora
      });
    }

    case 'rechazar': {
      if (linea.estado !== 'entrante' || !linea.entrante) return quieto();
      emitir('decline_call', { callId: linea.entrante.callId });
      return { linea: aInactiva({ ...linea, timbrando: sinTimbre(linea.timbrando, linea.entrante.callId) }, ahora), efectos };
    }

    case 'cancelar': {
      if (linea.estado === 'pidiendoMicro') {
        // Todavía no se ha emitido nada: nadie ha oído un timbre que cancelar.
        return { linea: aInactiva(linea, ahora), efectos };
      }
      if (linea.estado !== 'saliente') return quieto();
      if (linea.saliente) emitir('call_cancel', { callId: linea.saliente.callId });
      return { linea: cerrar(linea, 'cancelada_por_mi', ahora), efectos };
    }

    case 'colgar': {
      if (linea.estado === 'saliente' || linea.estado === 'pidiendoMicro') {
        return reducir(linea, { ...suceso, tipo: 'cancelar' });
      }
      if (!EN_LLAMADA.includes(linea.estado)) return quieto();
      emitir('end_call', {});
      return { linea: cerrar(linea, 'colgado_por_mi', ahora), efectos };
    }

    case 'invitar': {
      if (!EN_LLAMADA.includes(linea.estado)) return quieto();
      emitir('invite_to_pool', { targetPlayerId: suceso.a });
      return quieto();
    }

    case 'reintentar': {
      // Sólo tiene sentido cuando el fracaso es de ruta: reintentar un rechazo
      // sería volver a llamar, que es otro botón y otra intención.
      if (linea.estado !== 'sinRuta') return quieto();
      efectos.push({ tipo: 'reiniciarIce' });
      return con({ estado: 'enlazando', desde: ahora });
    }

    /* ─── Micrófono ─── */

    case 'microListo': {
      if (linea.estado !== 'pidiendoMicro' || !linea.intencion) return quieto();
      return { linea: cumplirIntencion(linea, linea.intencion, ahora, emitir), efectos };
    }

    case 'soloEscuchar': {
      // Sólo desde el resumen de un fallo de micrófono, y sólo con la intención
      // guardada: es un botón, no un modo al que se llegue sin querer.
      if (linea.estado !== 'cerrada' || !linea.intencion) return quieto();
      if (!String(linea.motivo).startsWith('micro_')) return quieto();
      return { linea: cumplirIntencion(linea, linea.intencion, ahora, emitir), efectos };
    }

    case 'microFallo': {
      if (linea.estado !== 'pidiendoMicro') return quieto();
      // NO SE EMITE NADA. Nadie recibe el timbre de alguien que va a salir mudo:
      // eso es exactamente el fallo de hoy, sólo que hoy además dice «Conectado».
      return { linea: cerrar(linea, suceso.motivo || 'micro_desconocido', ahora), efectos };
    }

    /* ─── Llamada saliente ─── */

    case 'call_outgoing': {
      if (linea.estado !== 'saliente') return quieto();
      return con({
        saliente: {
          callId: suceso.callId,
          targetPlayerId: suceso.targetPlayerId,
          targetName: suceso.targetName,
          expiraEn: suceso.expiraEn
        }
      });
    }

    case 'call_accepted': {
      if (linea.estado !== 'saliente') return quieto();
      return con({ estado: 'enlazando', desde: ahora });
    }

    case 'call_declined':
      if (linea.estado !== 'saliente') return quieto();
      return { linea: cerrar(linea, 'rechazada', ahora), efectos };

    case 'call_timeout':
    case 'timbreLocalTope':
      if (linea.estado !== 'saliente') return quieto();
      return { linea: cerrar(linea, 'sin_respuesta', ahora), efectos };

    case 'call_error': {
      const motivo = MOTIVO_DE_CODIGO[suceso.code];
      if (!motivo) return quieto();
      // Con la línea YA ABIERTA el error es la respuesta a una acción lateral
      // (invitar, pedir la voz de la mesa): informa y no cuelga. `enlazando`
      // queda FUERA de esta rama a propósito — ahí el error sí puede ser sobre
      // la llamada que se está estableciendo, y entonces hay que cerrarla.
      //
      // Aquí vive además el «aviso al séptimo» que promete el diseño: sin esta
      // rama, invitar a alguien con la línea llena no hacía absolutamente nada y
      // nadie podía saber por qué.
      const enCurso = EN_LLAMADA.includes(linea.estado) && linea.estado !== 'enlazando';
      if (enCurso) {
        const clave = AVISO_CON_LINEA_VIVA[suceso.code];
        if (clave) avisar(clave);
        return quieto();
      }
      if (linea.estado !== 'saliente' && linea.estado !== 'enlazando' && linea.estado !== 'pidiendoMicro') return quieto();
      return { linea: cerrar(linea, motivo, ahora), efectos };
    }

    /* ─── Llamada entrante ─── */

    case 'incoming_call': {
      const timbre = {
        callId: suceso.callId,
        fromPlayerId: suceso.fromPlayerId,
        fromName: suceso.fromName,
        // `clase`, y no `tipo`: `tipo` es el discriminante del propio suceso.
        // El payload del servidor trae 'directa' | 'grupo' | 'mesa' en `tipo`, y
        // quien traduce el suceso lo renombra al entrar.
        clase: suceso.clase || 'directa',
        expiraEn: suceso.expiraEn
      };
      const cola = [...sinTimbre(linea.timbrando, timbre.callId), timbre];
      if (linea.estado !== 'inactiva' && linea.estado !== 'cerrada') {
        // Llamada en espera: se apunta, no se roba la pantalla a la que ya hay.
        return con({ timbrando: cola });
      }
      return con({ estado: 'entrante', motivo: null, entrante: timbre, timbrando: cola, desde: ahora });
    }

    case 'call_cancelled': {
      const cola = sinTimbre(linea.timbrando, suceso.callId);
      if (linea.estado !== 'entrante' || !linea.entrante || linea.entrante.callId !== suceso.callId) {
        return con({ timbrando: cola });
      }
      if (suceso.motivo === 'atendida_en_otra_pestana') avisar('linea.atendidaEnOtraPestana');
      else avisar('linea.teLlamo', { name: linea.entrante.fromName });
      return { linea: aInactiva({ ...linea, timbrando: cola }, ahora), efectos };
    }

    case 'expiraEntrante': {
      if (linea.estado !== 'entrante' || !linea.entrante) return quieto();
      avisar('linea.teLlamo', { name: linea.entrante.fromName });
      return { linea: aInactiva({ ...linea, timbrando: sinTimbre(linea.timbrando, linea.entrante.callId) }, ahora), efectos };
    }

    case 'voice_taken': {
      // Estando en llamada, otra pestaña se llevó la sesión: aquí se desmonta.
      // Sonando, es sólo que la cuenta contestó en otro sitio: en silencio.
      if (linea.estado === 'entrante') {
        return { linea: aInactiva({ ...linea, timbrando: sinTimbre(linea.timbrando, suceso.callId) }, ahora), efectos };
      }
      if (!CON_MICRO.includes(linea.estado) && linea.estado !== 'pidiendoMicro') return quieto();
      return { linea: cerrar({ ...linea, enOtraPestana: true }, 'atendida_en_otra_pestana', ahora), efectos };
    }

    /* ─── Pool ─── */

    case 'voice_pool_joined':
    case 'voice_pool_updated': {
      const miembros = suceso.miembros || [];
      const contexto = suceso.contexto || linea.contexto;
      const esMesa = contexto && contexto.tipo === 'mesa';
      const base = { poolId: suceso.poolId, contexto, miembros, motivo: null };

      // Se queda solo. En una mesa eso es esperar a que llegue alguien; en una
      // llamada privada, es que el otro ha colgado.
      const seQuedaSolo = miembros.length <= 1 && !esMesa;
      const habiaCompania = linea.miembros.length > 1;
      if (seQuedaSolo && (['abierta', 'fragil', 'sinRuta'].includes(linea.estado) ||
                          (linea.estado === 'enlazando' && habiaCompania))) {
        return { linea: cerrar({ ...linea, ...base }, 'colgado_por_el_otro', ahora), efectos };
      }

      // ESTAR SOLO EN LA VOZ DE LA MESA ES UN ESTADO ESTABLE, NO UNA ESPERA.
      // No hay ningún par que enlazar: quedarse en «Enlazando…» sería la misma
      // clase de mentira que decía «Conectado P2P» sin conexión, sólo que en la
      // otra dirección — y no la desharía nada, porque nunca va a llegar un
      // `pares` que la corrija. El micro está abierto y la mesa ya ve «1 en la
      // voz»: eso es la línea abierta, con nadie más dentro.
      const destino = solo(contexto, miembros);

      // Tolerancia: si el servidor dice que estamos en un pool, estamos en un
      // pool. Llegar aquí desde 'inactiva' es lo que pasa al reengancharse tras
      // recargar la página, y negarlo dejaría la llamada viva y sin interfaz.
      if (!EN_LLAMADA.includes(linea.estado)) {
        return con({ ...base, estado: destino, intencion: null, saliente: null, entrante: null, desde: ahora });
      }
      if (linea.estado === 'recuperando' || (destino === 'abierta' && linea.estado === 'enlazando')) {
        return con({ ...base, estado: destino, desde: ahora });
      }
      return con(base);
    }

    case 'voice_pool_left': {
      if (suceso.poolId && linea.poolId && suceso.poolId !== linea.poolId) return quieto();
      if (!EN_LLAMADA.includes(linea.estado)) return quieto();
      return { linea: cerrar(linea, MOTIVO_DE_SALIDA[suceso.motivo] || 'colgado_por_mi', ahora), efectos };
    }

    /* ─── Calidad de la malla ─── */

    case 'pares': {
      if (!EN_LLAMADA.includes(linea.estado) || linea.estado === 'recuperando') return quieto();
      const r = resumenDePares(suceso.pares);
      if (r.total === 0) return quieto();
      const todosSinRuta = r.sinRuta === r.total;
      const aEstado = (destino) => (linea.estado === destino ? quieto() : con({ estado: destino, desde: ahora }));

      // Con alguien ENLAZADO la línea está abierta, y frágil si además hay
      // alguien que no está: sin ruta, ausente o inestable. En una malla lo
      // normal es que unos conecten y otros no.
      if (r.conectados > 0) {
        return aEstado(r.sinRuta > 0 || r.ausentes > 0 || r.inestables > 0 ? 'fragil' : 'abierta');
      }

      // Nadie enlazado del todo, pero alguien inestable: hay algo vivo. No es
      // `abierta` —no se puede afirmar que va bien— ni `enlazando`, que sería
      // negar una conversación que quizá se esté oyendo.
      if (r.inestables > 0) return aEstado('fragil');

      if (todosSinRuta) return aEstado('sinRuta');

      // Sin nadie conectado y sin que todos hayan fracasado: sigue enlazando.
      // Bajar desde abierta o frágil es honesto — el audio se fue de verdad.
      if (linea.estado === 'abierta' || linea.estado === 'fragil') {
        return con({ estado: 'enlazando', desde: ahora });
      }
      return quieto();
    }

    /* ─── Socket ─── */

    case 'desconectado': {
      if (EN_LLAMADA.includes(linea.estado) && linea.estado !== 'recuperando') {
        // Los RTCPeerConnection NO se cierran: una `pc` no muere porque muera el
        // socket de señalización. Si el reenganche llega a tiempo, el audio no
        // se cortó ni un instante.
        return con({ estado: 'recuperando', desde: ahora });
      }
      if (linea.estado === 'saliente') return { linea: cerrar(linea, 'sesion_perdida', ahora), efectos };
      if (linea.estado === 'entrante') return { linea: aInactiva(linea, ahora), efectos };
      return quieto();
    }

    case 'recuperandoTope':
      if (linea.estado !== 'recuperando') return quieto();
      return { linea: cerrar(linea, 'sesion_perdida', ahora), efectos };

    case 'voice_state': {
      const cambios = {
        enOtraPestana: !!suceso.enOtraPestana,
        timbrando: suceso.timbrando || []
      };
      if (suceso.pool) {
        const base = {
          ...cambios,
          poolId: suceso.pool.poolId,
          contexto: suceso.pool.contexto || null,
          miembros: suceso.pool.miembros || suceso.pool.members || [],
          motivo: null
        };
        const destino = solo(base.contexto, base.miembros);
        if (linea.estado === 'recuperando' || !EN_LLAMADA.includes(linea.estado)) {
          return con({ ...base, estado: destino, intencion: null, saliente: null, entrante: null, desde: ahora });
        }
        if (destino === 'abierta' && linea.estado === 'enlazando') {
          return con({ ...base, estado: destino, desde: ahora });
        }
        return con(base);
      }
      if (linea.estado === 'recuperando') {
        return { linea: cerrar({ ...linea, ...cambios }, 'sesion_perdida', ahora), efectos };
      }
      if (cambios.enOtraPestana && linea.estado === 'inactiva') avisar('linea.enOtraPestana');
      return con(cambios);
    }

    /* ─── Fin del resumen ─── */

    case 'cerradaVista':
      if (linea.estado !== 'cerrada') return quieto();
      return { linea: aInactiva(linea, ahora), efectos };

    default:
      return quieto();
  }
}
