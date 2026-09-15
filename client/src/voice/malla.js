/**
 * La malla de pares: crear, señalizar, medir y destruir RTCPeerConnection.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AVISO DE MANTENIMIENTO — LA NEGOCIACIÓN PERFECTA NO SE REESCRIBE
 *
 * El bloque de `senal()` (colisión de ofertas, `ignoreOffer`, la guarda de
 * `answer` fuera de `have-local-offer` y la cola de candidatos pendientes) y el
 * par `onsignalingstatechange` / `onnegotiationneeded` con el truco de
 * `canRenegotiate` vienen LITERALMENTE de `useVoiceChat.js:597-648` y :271-306.
 * Se han movido de archivo y no se ha tocado su lógica: es la parte más difícil
 * de WebRTC, está bien resuelta, y quien la «limpia» descubre el estropicio sólo
 * en producción y sólo con dos personas ofertando a la vez.
 *
 * Lo único que cambia respecto al original, y por qué:
 *  · `polite` compara ids de CUENTA en los dos extremos. Antes comparaba el
 *    alias de asiento contra el id de cuenta del otro, así que `a < b` dejaba de
 *    ser complementaria y los dos lados podían creerse educados. La regla —el
 *    iniciador es también el educado, que es lo contrario del convenio habitual
 *    pero es correcto porque sólo hace falta que exactamente uno lo sea— se
 *    conserva tal cual.
 *  · `voice_pool_signal` viaja SIN `poolId`: el servidor lo deriva de la
 *    pertenencia del emisor (contrato §4.3), y así no se puede inyectar señal
 *    en un pool ajeno ni siquiera equivocándose.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Lo que sí es nuevo aquí: los manejadores de estado por par (antes no había ni
 * uno en todo `client/src`), el `restartIce()` gratuito a los 6 s, `sin_ruta`
 * por par a los 15 s SIN cerrar el `pc` —sigue intentándolo y si conecta tarde
 * la fila vuelve a verde sola— y el par ido a los 20 s.
 */

import { crearSeguidorDePar, ESTADOS_COMPARTIBLES } from './calidad';
import { PAR_REINICIO_ICE, PAR_ESTADO_MINIMO } from './tiempos';

export function crearMalla({
  socket,
  cuentaId,
  obtenerIce,
  obtenerStream,
  pistaDeVideo,
  hayPool,
  alPar,
  alVideoRemoto,
  estaEnsordecido,
  altavoz
}) {
  /** targetPlayerId -> { pc, audio, pendingCandidates, makingOffer, ignoreOffer, canRenegotiate, polite, seguidor, nacidoEn, ausente, reinicioHecho, estado, ultimoAviso } */
  const pares = new Map();
  /** Reservas síncronas: `crearPar` tiene dos `await` antes de poder registrarse. */
  const enCurso = new Set();
  let vivo = true;

  const leer = (fn, porDefecto) => (typeof fn === 'function' ? fn() : porDefecto);

  function emitirSenal(toPlayerId, signal) {
    socket.emit('voice_pool_signal', { toPlayerId, signal });
  }

  function anunciarEstado(id, estado) {
    const par = pares.get(id);
    if (!par) return;
    if (par.estado === estado) return;
    par.estado = estado;
    if (typeof alPar === 'function') alPar(id, estado);
    // Diagnóstico bilateral: cada extremo sólo ve su mitad, así que se la cuenta
    // al otro. Estrangulado por pareja para no convertir el socket en un chorro.
    if (!ESTADOS_COMPARTIBLES.includes(estado)) return;
    const ahora = Date.now();
    if (ahora - par.ultimoAviso < PAR_ESTADO_MINIMO) return;
    par.ultimoAviso = ahora;
    socket.emit('voice_peer_state', { peerPlayerId: id, estado });
  }

  async function crearPar(targetPlayerId, isInitiator) {
    if (pares.has(targetPlayerId)) return pares.get(targetPlayerId);
    if (enCurso.has(targetPlayerId)) return null;
    // La reserva es SÍNCRONA a propósito: entre el `await` del ICE y el del
    // micro caben dos `voice_pool_updated` seguidos, y sin ella saldrían dos
    // RTCPeerConnection contra la misma persona.
    enCurso.add(targetPlayerId);

    let stream = null;
    let iceConfig = null;
    try {
      iceConfig = await obtenerIce();
      stream = await obtenerStream();
    } catch (e) {
      enCurso.delete(targetPlayerId);
      throw e;
    }
    if (!vivo || pares.has(targetPlayerId)) { enCurso.delete(targetPlayerId); return pares.get(targetPlayerId) || null; }

    const pc = new RTCPeerConnection(iceConfig);
    const polite = cuentaId < targetPlayerId;
    const nacidoEn = Date.now();
    const peerData = {
      pc,
      audio: null,
      pendingCandidates: [],
      makingOffer: false,
      ignoreOffer: false,
      // Solo se renegocia una vez asentada la conexión inicial (ver
      // onsignalingstatechange / onnegotiationneeded más abajo).
      canRenegotiate: false,
      polite,
      nacidoEn,
      ausente: false,
      reinicioHecho: false,
      estado: null,
      ultimoAviso: 0,
      seguidor: crearSeguidorDePar({ nacidoEn })
    };
    pares.set(targetPlayerId, peerData);
    enCurso.delete(targetPlayerId);

    // Las pistas llegan ya con `enabled` puesto según el silencio actual: lo
    // fija `mediosLocales` al abrir el micro y al alternar el mudo, que es su
    // trabajo. Aquí sólo se enchufan.
    if (stream) {
      stream.getTracks().forEach(track => { pc.addTrack(track, stream); });
    } else if (typeof pc.addTransceiver === 'function') {
      // «Entrar solo a escuchar»: sin pista propia, una oferta no llevaría
      // ninguna línea de medios y el otro extremo no tendría nada que
      // responder. El transceptor de sólo recepción es lo que la hace válida.
      try { pc.addTransceiver('audio', { direction: 'recvonly' }); } catch { /* navegador viejo */ }
    }

    // Si la cámara ya está activa, agregar la pista de vídeo
    const vTrackActual = leer(pistaDeVideo, null);
    if (vTrackActual) pc.addTrack(vTrackActual, new MediaStream([vTrackActual]));

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && leer(hayPool, false)) {
        emitirSenal(targetPlayerId, { candidate });
      }
    };

    // La conexión se considera "asentada" la primera vez que vuelve a 'stable'
    // teniendo ya descripción remota, es decir, cuando el intercambio inicial de
    // oferta/respuesta ha terminado. A partir de ahí sí renegociamos.
    pc.onsignalingstatechange = () => {
      if (pc.signalingState === 'stable' && pc.remoteDescription) {
        peerData.canRenegotiate = true;
      }
    };

    // RENEGOCIACIÓN. Faltaba por completo: `toggleCam` hacía addTrack/removeTrack
    // sobre conexiones ya negociadas y el otro par NUNCA se enteraba, así que
    // encender la cámara a mitad de llamada solo "funcionaba" si ya estaba
    // encendida antes de crear el peer.
    //
    // Se ignora el disparo inicial (el que provoca añadir el micro al crear la
    // conexión): esa primera oferta la maneja el flujo de creación / respuesta.
    // Tocarla habría cambiado el establecimiento de la llamada, que funciona.
    // Aquí solo se atienden los cambios POSTERIORES de pistas.
    pc.onnegotiationneeded = async () => {
      if (!peerData.canRenegotiate) return;
      if (pc.signalingState !== 'stable') return;
      if (!leer(hayPool, false)) return;
      try {
        peerData.makingOffer = true;
        const offer = await pc.createOffer();
        // Entre el await y aquí puede haber llegado una oferta del otro par.
        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription(offer);
        emitirSenal(targetPlayerId, { description: pc.localDescription });
      } catch (e) {
        console.warn('[voz renegociación error]', e);
      } finally {
        peerData.makingOffer = false;
      }
    };

    pc.ontrack = ({ track, streams }) => {
      if (track.kind === 'audio') {
        let audio = peerData.audio;
        if (!audio) {
          audio = document.createElement('audio');
          audio.autoplay = true;
          audio.setAttribute('playsinline', '');
          audio.style.display = 'none';
          document.body.appendChild(audio);
          const salida = leer(altavoz, '');
          if (salida && audio.setSinkId) {
            audio.setSinkId(salida).catch(() => {});
          }
          peerData.audio = audio;
        }
        audio.muted = leer(estaEnsordecido, false);
        audio.srcObject = streams[0] || new MediaStream([track]);
        audio.play().catch(e => console.warn('[voz audio play error]', e));
      } else if (track.kind === 'video') {
        const vStream = streams[0] || new MediaStream([track]);
        if (typeof alVideoRemoto === 'function') alVideoRemoto(targetPlayerId, vStream);
        track.onended = () => {
          if (typeof alVideoRemoto === 'function') alVideoRemoto(targetPlayerId, null);
        };
      }
    };

    // Los dos manejadores que no existían en todo `client/src`. Sin ellos, un
    // ICE que falla —el caso ESPERADO sin TURN, no la excepción rara— no tenía
    // forma alguna de llegar a la pantalla.
    pc.onconnectionstatechange = () => { evaluar(targetPlayerId); };
    pc.oniceconnectionstatechange = () => { evaluar(targetPlayerId); };

    if (isInitiator) {
      try {
        peerData.makingOffer = true;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        emitirSenal(targetPlayerId, { description: pc.localDescription });
      } catch (e) {
        console.warn('[voz offer error]', e);
      } finally {
        peerData.makingOffer = false;
      }
    }

    evaluar(targetPlayerId);
    return peerData;
  }

  function destruirPar(peerPlayerId) {
    const peer = pares.get(peerPlayerId);
    if (!peer) return;
    try {
      if (peer.audio) {
        peer.audio.pause();
        peer.audio.srcObject = null;
        peer.audio.remove();
      }
      if (peer.pc) peer.pc.close();
    } catch { /* noop */ }
    pares.delete(peerPlayerId);
    if (typeof alVideoRemoto === 'function') alVideoRemoto(peerPlayerId, null);
    // El punto verde de quien se va justo mientras hablaba se quedaba encendido
    // para siempre: el estado 'ido' es lo que lo apaga aguas arriba.
    if (typeof alPar === 'function') alPar(peerPlayerId, 'ido');
  }

  /* La cola de una sola plaza que serializa `sincronizar` (ver su comentario). */
  let pendiente = null;
  let enMarcha = null;
  /**
   * Sube cada vez que la malla se tira entera. Un recorrido que estuviera
   * esperando al micrófono cuando alguien colgó reanudaría después y abriría
   * pares para una llamada que ya no existe: conexiones nuevas nacidas muertas
   * y un micro que se queda encendido.
   */
  let generacion = 0;

  /** UNA pasada de ajuste sobre una lista concreta de miembros. */
  async function unaPasada(miembros) {
    const gen = generacion;
    const vivos = new Set();
    for (const m of miembros) {
      if (gen !== generacion) return;
      const id = m.playerId;
      if (!id || id === cuentaId) continue;
      vivos.add(id);
      const par = pares.get(id);
      if (par) {
        const ausente = m.estado === 'ausente';
        if (par.ausente !== ausente) { par.ausente = ausente; evaluar(id); }
        continue;
      }
      // El iniciador se decide por comparación lexicográfica de ids de cuenta,
      // igual que `polite`: el mismo criterio en los dos extremos.
      await crearPar(id, cuentaId < id).catch(e => {
        console.warn('[voz] no se pudo crear el par', id, e && e.message);
        throw e;
      });
      if (gen !== generacion) { destruirPar(id); return; }
      const nuevo = pares.get(id);
      if (nuevo) nuevo.ausente = m.estado === 'ausente';
    }
    if (gen !== generacion) return;
    // Quien ya no está en el pool se destruye. La lista es la verdad.
    for (const id of [...pares.keys()]) {
      if (!vivos.has(id)) destruirPar(id);
    }
  }

  /** Recorre listas mientras sigan llegando. Si una revienta, la cola se vacía. */
  async function vaciarPendiente() {
    try {
      while (pendiente) {
        const lista = pendiente;
        pendiente = null;
        await unaPasada(lista);
      }
    } catch (e) {
      pendiente = null;
      throw e;
    }
  }

  /** Relee un par y publica su estado. Se llama al cambiar el pc y en cada muestreo. */
  function evaluar(id, informe = null, sinEstadisticas = false) {
    const par = pares.get(id);
    if (!par) return null;
    const estado = par.seguidor.observar({
      ahora: Date.now(),
      connectionState: par.pc.connectionState,
      iceConnectionState: par.pc.iceConnectionState,
      tieneRemota: !!par.pc.remoteDescription,
      ausente: par.ausente,
      informe,
      sinEstadisticas
    });
    anunciarEstado(id, estado);
    if (estado === 'ido') destruirPar(id);
    return estado;
  }

  return {
    /** Estado actual de cada par: { cuentaId: 'enlazado_bien' | … }. */
    estados() {
      const salida = {};
      pares.forEach((par, id) => { salida[id] = par.estado || 'negociando'; });
      return salida;
    },

    tiene(id) { return pares.has(id); },
    cuantos() { return pares.size; },

    /**
     * Ajusta la malla a la lista de miembros del pool. Crear y destruir SIEMPRE
     * pasa por aquí: la pertenencia la dice el servidor, no el cliente.
     *
     * SERIALIZADO, y no como precaución teórica. Dos `voice_pool_updated`
     * seguidos —dos personas que entran casi a la vez— solapaban dos recorridos,
     * y el barrido final del PRIMERO («destruye a quien ya no está en mi lista»)
     * se llevaba por delante el par que acababa de crear el SEGUNDO. El síntoma
     * es un participante mudo para siempre: sin error, sin log y sin nada que lo
     * delate hasta que alguien pregunta «¿me oís?». Hay un caso que lo reproduce.
     *
     * Se guarda la última lista y se vuelve a recorrer al terminar la anterior:
     * gana la última, que es lo correcto porque la última es la del servidor.
     */
    sincronizar(miembros = []) {
      pendiente = miembros;
      if (!enMarcha) enMarcha = vaciarPendiente().finally(() => { enMarcha = null; });
      return enMarcha;
    },

    /**
     * Señalización entrante. NEGOCIACIÓN PERFECTA — no tocar (ver la cabecera).
     */
    async senal(fromPlayerId, signal) {
      if (!fromPlayerId || !signal) return;

      let peerData = pares.get(fromPlayerId);
      if (!peerData) {
        peerData = await crearPar(fromPlayerId, false);
      }
      if (!peerData) return;

      const { pc, polite } = peerData;
      try {
        if (signal.description) {
          const { description } = signal;
          const offerCollision = (description.type === 'offer') &&
            (peerData.makingOffer || pc.signalingState !== 'stable');

          peerData.ignoreOffer = !polite && offerCollision;
          if (peerData.ignoreOffer) return;

          if (description.type === 'answer' && pc.signalingState !== 'have-local-offer') {
            return;
          }

          await pc.setRemoteDescription(description);

          if (peerData.pendingCandidates.length) {
            for (const candidate of peerData.pendingCandidates) {
              try { await pc.addIceCandidate(candidate); } catch { /* candidato caducado */ }
            }
            peerData.pendingCandidates = [];
          }

          if (description.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            emitirSenal(fromPlayerId, { description: pc.localDescription });
          }
        } else if (signal.candidate) {
          if (!pc.remoteDescription || !pc.remoteDescription.type) {
            peerData.pendingCandidates.push(signal.candidate);
          } else {
            try { await pc.addIceCandidate(signal.candidate); } catch { /* candidato caducado */ }
          }
        }
      } catch (e) {
        console.warn('[voz pool signal error]', e);
      }
      evaluar(fromPlayerId);
    },

    /**
     * Un ciclo de medida. Es también el reloj de los tres plazos por par: el
     * `restartIce()` gratuito de los 6 s, el `sin_ruta` de los 15 y el `ido` de
     * los 20. Uno solo, y no tres temporizadores por conexión.
     */
    async muestrear() {
      const ahora = Date.now();
      for (const [id, par] of [...pares.entries()]) {
        const conectado = par.pc.connectionState === 'connected' || par.pc.iceConnectionState === 'connected';
        // El remedio más barato del protocolo, UNA vez y en silencio. Nunca se
        // declara `sin_ruta` sin haberlo intentado.
        if (!conectado && !par.reinicioHecho && ahora - par.nacidoEn >= PAR_REINICIO_ICE) {
          par.reinicioHecho = true;
          try { par.pc.restartIce(); } catch { /* navegador sin restartIce */ }
        }
        let informe = null;
        let sinEstadisticas = false;
        if (typeof par.pc.getStats !== 'function') sinEstadisticas = true;
        else {
          try { informe = await par.pc.getStats(); } catch { sinEstadisticas = true; }
        }
        evaluar(id, informe, sinEstadisticas);
      }
    },

    /** [Reintentar] de la tarjeta de «sin ruta»: un ICE nuevo en todos los pares. */
    reiniciarIce() {
      pares.forEach((par) => {
        par.reinicioHecho = true;
        try { par.pc.restartIce(); } catch { /* noop */ }
      });
    },

    aplicarSilencio(silenciado) {
      pares.forEach(({ pc }) => {
        pc.getSenders().forEach(sender => {
          if (sender.track && sender.track.kind === 'audio') {
            sender.track.enabled = !silenciado;
          }
        });
      });
    },

    aplicarEnsordecido(v) {
      pares.forEach(peer => { if (peer.audio) peer.audio.muted = v; });
    },

    aplicarAltavoz(deviceId) {
      pares.forEach(peer => {
        if (peer.audio && peer.audio.setSinkId) peer.audio.setSinkId(deviceId).catch(() => {});
      });
    },

    reemplazarAudio(track) {
      pares.forEach(({ pc }) => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (sender) sender.replaceTrack(track);
      });
    },

    anadirVideo(track, stream) {
      pares.forEach(({ pc }) => { pc.addTrack(track, stream); });
    },

    reemplazarVideo(track) {
      pares.forEach(({ pc }) => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(track);
      });
    },

    quitarVideo() {
      pares.forEach(({ pc }) => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) pc.removeTrack(sender);
      });
    },

    destruirPar,

    /**
     * Se acabó la llamada: pares cerrados y los `<audio>` fuera del body. La
     * malla sigue siendo utilizable — la siguiente llamada reutiliza la misma
     * instancia.
     */
    destruirTodo() {
      // La generación invalida cualquier recorrido que estuviera esperando: sin
      // esto, un `sincronizar` parado en el micrófono cuando el otro colgó
      // reanudaría después y abriría pares para una llamada que ya no existe.
      generacion += 1;
      pendiente = null;
      for (const id of [...pares.keys()]) destruirPar(id);
      pares.clear();
      enCurso.clear();
    },

    /** Desmontaje del motor entero: además, esta malla ya no vuelve a crear nada. */
    desmontar() {
      vivo = false;
      generacion += 1;
      pendiente = null;
      for (const id of [...pares.keys()]) destruirPar(id);
      pares.clear();
      enCurso.clear();
    }
  };
}
