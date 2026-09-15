import { describe, it, expect } from 'vitest';
import {
  reducir, lineaInicial, resumenDePares, MOTIVO_DE_CODIGO, CLAVE_DE_CIERRE, EN_LLAMADA
} from './maquina';

/**
 * La tabla de transiciones del contrato §2.1, sin huecos.
 *
 * Todo esto es alcanzable sin navegador y sin React porque el reductor es puro,
 * que es exactamente el punto: la máquina de la llamada —timbrar, aceptar,
 * rechazar, caducar, colgar, reengancharse— no tenía NI UNA aserción en todo el
 * proyecto, y era la pieza que más mentía.
 */

const AHORA = 1_000_000;

/** Aplica una secuencia de sucesos desde el estado inicial (o desde otro dado). */
function correr(sucesos, desde = lineaInicial()) {
  let linea = desde;
  let efectos = [];
  for (const s of sucesos) {
    const r = reducir(linea, { ahora: AHORA, ...s });
    linea = r.linea;
    efectos = efectos.concat(r.efectos);
  }
  return { linea, efectos };
}

const emitidos = (efectos) => efectos.filter(e => e.tipo === 'emitir').map(e => e.evento);
const cargaDe = (efectos, evento) => (efectos.find(e => e.tipo === 'emitir' && e.evento === evento) || {}).payload;
const avisos = (efectos) => efectos.filter(e => e.tipo === 'aviso').map(e => e.key);

/** Un pool de dos personas ya establecido, que es de donde arrancan medio contrato. */
function enLlamada(estado = 'abierta') {
  return {
    ...lineaInicial(),
    estado,
    poolId: 'pool1',
    contexto: { tipo: 'privado', roomId: null },
    miembros: [
      { playerId: 'p_yo', name: 'Yo', estado: 'presente' },
      { playerId: 'p_ana', name: 'Ana', estado: 'presente' }
    ]
  };
}

describe('maquina · pedir el micro antes de molestar a nadie', () => {
  it('llamar pasa por pidiendoMicro y NO emite todavía', () => {
    const { linea, efectos } = correr([{ tipo: 'llamar', a: 'p_ana', nombre: 'Ana' }]);
    expect(linea.estado).toBe('pidiendoMicro');
    expect(linea.intencion).toEqual({ tipo: 'llamar', a: 'p_ana', nombre: 'Ana' });
    expect(emitidos(efectos)).toEqual([]);
    expect(efectos.some(e => e.tipo === 'pedirMicro')).toBe(true);
  });

  it('con el micro listo se emite call_friend y se pasa a saliente', () => {
    const { linea, efectos } = correr([
      { tipo: 'llamar', a: 'p_ana' },
      { tipo: 'microListo' }
    ]);
    expect(linea.estado).toBe('saliente');
    expect(cargaDe(efectos, 'call_friend')).toEqual({ targetPlayerId: 'p_ana' });
  });

  /**
   * El fallo que hacía a la interfaz decir «Conectado P2P» estando mudo: el
   * micro fallaba, nadie comprobaba el null y la llamada se establecía igual.
   * Aquí el error CIERRA y, sobre todo, NO EMITE: nadie recibe el timbre de
   * alguien que va a salir mudo.
   */
  it('un micro bloqueado cierra la llamada y no manda nada', () => {
    const { linea, efectos } = correr([
      { tipo: 'llamar', a: 'p_ana' },
      { tipo: 'microFallo', motivo: 'micro_bloqueado' }
    ]);
    expect(linea.estado).toBe('cerrada');
    expect(linea.motivo).toBe('micro_bloqueado');
    expect(emitidos(efectos)).toEqual([]);
  });

  /**
   * Solo-escucha existe, pero SÓLO aquí: pulsando un botón que dice lo que hace,
   * con el motivo del fallo delante. Como consecuencia automática de un micro
   * roto sería la versión educada del bug de hoy — el teléfono del otro suena,
   * contesta, y descubre que no puedes hablarle.
   */
  it('entrar solo a escuchar retoma la intención guardada', () => {
    const roto = correr([
      { tipo: 'llamar', a: 'p_ana' },
      { tipo: 'microFallo', motivo: 'micro_ausente' }
    ]).linea;
    expect(roto.intencion).toEqual({ tipo: 'llamar', a: 'p_ana', nombre: '' });

    const { linea, efectos } = correr([{ tipo: 'soloEscuchar' }], roto);
    expect(cargaDe(efectos, 'call_friend')).toEqual({ targetPlayerId: 'p_ana' });
    expect(linea).toMatchObject({ estado: 'saliente', motivo: null });
  });

  it('y NO se puede llegar a solo-escucha desde un cierre que no sea del micro', () => {
    const rechazada = correr([{ tipo: 'call_declined' }],
      correr([{ tipo: 'llamar', a: 'p_ana' }, { tipo: 'microListo' }]).linea).linea;
    expect(rechazada.intencion).toBe(null);
    const { linea, efectos } = correr([{ tipo: 'soloEscuchar' }], rechazada);
    expect(linea.estado).toBe('cerrada');
    expect(efectos).toEqual([]);
  });

  it('el tope del micro es un motivo más, no una excepción', () => {
    const { linea } = correr([
      { tipo: 'llamar', a: 'p_ana' },
      { tipo: 'microFallo', motivo: 'micro_sin_respuesta' }
    ]);
    expect(linea).toMatchObject({ estado: 'cerrada', motivo: 'micro_sin_respuesta' });
  });

  it('entrar a la mesa emite join_table_voice y NO timbra a nadie', () => {
    const { linea, efectos } = correr([{ tipo: 'entrarAMesa' }, { tipo: 'microListo' }]);
    expect(linea.estado).toBe('enlazando');
    expect(emitidos(efectos)).toEqual(['join_table_voice']);
  });
});

describe('maquina · la llamada saliente', () => {
  const saliendo = () => correr([{ tipo: 'llamar', a: 'p_ana' }, { tipo: 'microListo' }]).linea;

  it('call_outgoing guarda el callId y la caducidad', () => {
    const { linea } = correr([
      { tipo: 'call_outgoing', callId: 'c1', targetPlayerId: 'p_ana', targetName: 'Ana', expiraEn: AHORA + 30000 }
    ], saliendo());
    expect(linea.saliente).toEqual({ callId: 'c1', targetPlayerId: 'p_ana', targetName: 'Ana', expiraEn: AHORA + 30000 });
  });

  it('call_accepted pasa a enlazando, NO a abierta', () => {
    const { linea } = correr([{ tipo: 'call_accepted', callId: 'c1' }], saliendo());
    // El punto crítico del contrato: aceptar no es oírse. `abierta` exige un par
    // enlazado, y enlazado exige bytes de audio entrando.
    expect(linea.estado).toBe('enlazando');
  });

  it('call_declined cierra con rechazada', () => {
    expect(correr([{ tipo: 'call_declined' }], saliendo()).linea)
      .toMatchObject({ estado: 'cerrada', motivo: 'rechazada' });
  });

  it('call_timeout y el tope local cierran los dos con sin_respuesta', () => {
    expect(correr([{ tipo: 'call_timeout' }], saliendo()).linea.motivo).toBe('sin_respuesta');
    expect(correr([{ tipo: 'timbreLocalTope' }], saliendo()).linea.motivo).toBe('sin_respuesta');
  });

  it('cancelar emite call_cancel, que antes era imposible', () => {
    const conCall = correr([{ tipo: 'call_outgoing', callId: 'c1' }], saliendo()).linea;
    const { linea, efectos } = correr([{ tipo: 'cancelar' }], conCall);
    expect(cargaDe(efectos, 'call_cancel')).toEqual({ callId: 'c1' });
    expect(linea).toMatchObject({ estado: 'cerrada', motivo: 'cancelada_por_mi' });
  });

  /**
   * El camino que dejaba «Llamando…» para siempre: el servidor devolvía
   * `call_error` y retornaba ANTES de crear la llamada, así que tampoco armaba
   * su temporizador de 30 s. El cliente no escuchaba `call_error` en ningún
   * sitio (grep: cero coincidencias).
   */
  it('cada call_error tiene su motivo, y los dos que no se cuentan se descartan', () => {
    for (const [code, motivo] of Object.entries(MOTIVO_DE_CODIGO)) {
      if (motivo === 'ya_en_linea') continue; // tiene su propio caso
      const { linea } = correr([{ tipo: 'call_error', code }], saliendo());
      expect(linea, `code ${code}`).toMatchObject({ estado: 'cerrada', motivo });
    }
    for (const code of ['no_miembro', 'a_ti_mismo', 'inventado']) {
      expect(correr([{ tipo: 'call_error', code }], saliendo()).linea.estado, code).toBe('saliente');
    }
  });

  it('ya_en_linea informa pero NO tumba la conversación en curso', () => {
    const { linea, efectos } = correr([{ tipo: 'call_error', code: 'ya_en_linea' }], enLlamada());
    expect(linea.estado).toBe('abierta');
    expect(avisos(efectos)).toContain('linea.yaEnLinea');
  });

  /**
   * El «aviso al séptimo» que el diseño promete. `linea_llena` sólo llega en
   * respuesta a un `invite_to_pool`, es decir, SIEMPRE desde una línea viva: si
   * cerrara la llamada, invitar a alguien de más colgaría a los que ya se estaban
   * oyendo. Y si no avisara, el botón de invitar no haría nada y nadie sabría por
   * qué — que es el silencio que este paquete viene a cerrar.
   */
  it('linea_llena avisa al séptimo sin colgar a los seis primeros', () => {
    const { linea, efectos } = correr([{ tipo: 'call_error', code: 'linea_llena' }], enLlamada());
    expect(linea.estado).toBe('abierta');
    expect(avisos(efectos)).toContain('linea.lineaLlena');
  });

  it('pero linea_llena al ARRANCAR la llamada sí la cierra, con su motivo', () => {
    const { linea } = correr([{ tipo: 'call_error', code: 'linea_llena' }], saliendo());
    expect(linea).toMatchObject({ estado: 'cerrada', motivo: 'linea_llena' });
  });

  /**
   * Invitar a alguien que no puede atender es la respuesta a una acción LATERAL,
   * no a la conversación en curso. Colgarla por eso castigaría al que sí estaba
   * al otro lado; tragárselo dejaría el botón de invitar sin efecto visible.
   */
  it('un error de invitación con la línea abierta informa y no cuelga a nadie', () => {
    for (const [code, clave] of Object.entries({
      enfriamiento: 'linea.enfriamiento',
      no_molestar: 'linea.noMolestar',
      no_amigos: 'linea.noAmigos',
      desconectado: 'linea.amigoDesconectado'
    })) {
      const { linea, efectos } = correr([{ tipo: 'call_error', code }], enLlamada());
      expect(linea.estado, code).toBe('abierta');
      expect(avisos(efectos), code).toContain(clave);
    }
  });

  it('no_existe con la línea abierta se descarta: su copy sería falsa', () => {
    const { linea, efectos } = correr([{ tipo: 'call_error', code: 'no_existe' }], enLlamada());
    expect(linea.estado).toBe('abierta');
    expect(avisos(efectos)).toEqual([]);
  });

  /**
   * `enlazando` NO entra en la rama informativa: ahí el error puede ser sobre la
   * llamada que se está estableciendo (el `join_table_voice` que acaba de salir),
   * y tragárselo dejaría «Enlazando…» para siempre — que es literalmente el
   * defecto del que viene este paquete.
   */
  it('enlazando sigue cerrando: ahí el error sí puede ser de la propia llamada', () => {
    const { linea } = correr([{ tipo: 'call_error', code: 'no_existe' }], enLlamada('enlazando'));
    expect(linea).toMatchObject({ estado: 'cerrada', motivo: 'colgado_por_el_otro' });
  });

  it('todo motivo de cierre tiene su clave, y ninguna clave se llama como el motivo', () => {
    for (const motivo of Object.values(MOTIVO_DE_CODIGO)) {
      expect(CLAVE_DE_CIERRE[motivo], motivo).toMatch(/^linea\./);
    }
    // Los micro_* NO están aquí: su clave la trae `micError.clave`, que la pone
    // mediosLocales, que es quien conoce la taxonomía del navegador.
    expect(CLAVE_DE_CIERRE.micro_bloqueado).toBeUndefined();
  });
});

describe('maquina · el timbre entrante', () => {
  const sonando = () => correr([
    { tipo: 'incoming_call', callId: 'c9', fromPlayerId: 'p_ana', fromName: 'Ana', clase: 'directa', expiraEn: AHORA + 30000 }
  ]).linea;

  it('incoming_call pone la línea en entrante con su cuenta atrás', () => {
    const linea = sonando();
    expect(linea.estado).toBe('entrante');
    expect(linea.entrante).toMatchObject({ callId: 'c9', fromName: 'Ana', clase: 'directa', expiraEn: AHORA + 30000 });
  });

  it('aceptar pide micro primero y sólo después emite accept_call', () => {
    const { linea: pidiendo, efectos: e1 } = correr([{ tipo: 'aceptar' }], sonando());
    expect(pidiendo.estado).toBe('pidiendoMicro');
    expect(emitidos(e1)).toEqual([]);
    const { linea, efectos } = correr([{ tipo: 'microListo' }], pidiendo);
    expect(cargaDe(efectos, 'accept_call')).toEqual({ callId: 'c9' });
    expect(linea.estado).toBe('enlazando');
  });

  it('rechazar emite decline_call y vuelve a inactiva', () => {
    const { linea, efectos } = correr([{ tipo: 'rechazar' }], sonando());
    expect(cargaDe(efectos, 'decline_call')).toEqual({ callId: 'c9' });
    expect(linea.estado).toBe('inactiva');
    expect(linea.timbrando).toEqual([]);
  });

  it('call_cancelled por haber contestado en otra pestaña deja su traza', () => {
    const { linea, efectos } = correr(
      [{ tipo: 'call_cancelled', callId: 'c9', motivo: 'atendida_en_otra_pestana' }], sonando());
    expect(linea.estado).toBe('inactiva');
    expect(avisos(efectos)).toEqual(['linea.atendidaEnOtraPestana']);
  });

  it('una llamada que caduca deja traza de perdida', () => {
    const { linea, efectos } = correr([{ tipo: 'expiraEntrante' }], sonando());
    expect(linea.estado).toBe('inactiva');
    expect(avisos(efectos)).toEqual(['linea.teLlamo']);
  });

  it('voice_taken sonando apaga el timbre EN SILENCIO', () => {
    const { linea, efectos } = correr([{ tipo: 'voice_taken', callId: 'c9' }], sonando());
    expect(linea.estado).toBe('inactiva');
    expect(efectos).toEqual([]);
  });

  it('voice_taken estando en llamada la cierra: la sesión es de otra pestaña', () => {
    const { linea } = correr([{ tipo: 'voice_taken', callId: null }], enLlamada());
    expect(linea).toMatchObject({ estado: 'cerrada', motivo: 'atendida_en_otra_pestana', enOtraPestana: true });
  });

  it('un timbre que llega en plena llamada NO roba la pantalla: se apunta', () => {
    const { linea } = correr([
      { tipo: 'incoming_call', callId: 'c2', fromPlayerId: 'p_luis', fromName: 'Luis' }
    ], enLlamada());
    expect(linea.estado).toBe('abierta');
    expect(linea.timbrando.map(t => t.callId)).toEqual(['c2']);
  });
});

describe('maquina · el pool', () => {
  it('voice_pool_updated construye la línea aunque se venga de inactiva', () => {
    // Es el reenganche tras recargar la página: si el servidor dice que estamos
    // en un pool, estamos en un pool. Negarlo dejaba la llamada viva y sin
    // interfaz con la que colgarla.
    const { linea } = correr([{
      tipo: 'voice_pool_updated',
      poolId: 'pool1',
      contexto: { tipo: 'privado', roomId: null },
      miembros: [{ playerId: 'p_yo' }, { playerId: 'p_ana' }]
    }]);
    expect(linea).toMatchObject({ estado: 'enlazando', poolId: 'pool1' });
    expect(linea.miembros).toHaveLength(2);
  });

  it('quedarse solo en una línea privada es que el otro colgó', () => {
    const { linea } = correr([{
      tipo: 'voice_pool_updated', poolId: 'pool1',
      contexto: { tipo: 'privado', roomId: null },
      miembros: [{ playerId: 'p_yo' }]
    }], enLlamada());
    expect(linea).toMatchObject({ estado: 'cerrada', motivo: 'colgado_por_el_otro' });
  });

  /**
   * Entrar el primero en la voz de una mesa vacía. No hay ningún par que abrir,
   * así que ningún `pares` va a sacar nunca de «Enlazando…»: eso se quedaría
   * puesto para siempre, que es literalmente el defecto del que viene este
   * paquete, sólo que en la otra dirección. El micro está abierto y la mesa ya
   * ve «1 en la voz».
   */
  it('entrar solo en la voz de la mesa es la línea ABIERTA, no una espera eterna', () => {
    const { linea } = correr([{
      tipo: 'voice_pool_joined', poolId: 'tvoice_ABCD', contexto: { tipo: 'mesa', roomId: 'ABCD' },
      miembros: [{ playerId: 'p_yo', name: 'Yo', estado: 'presente' }]
    }]);
    expect(linea.estado).toBe('abierta');
  });

  it('y en cuanto llega alguien vuelve a enlazando, que es lo que toca', () => {
    const solo = correr([{
      tipo: 'voice_pool_joined', poolId: 'tvoice_ABCD', contexto: { tipo: 'mesa', roomId: 'ABCD' },
      miembros: [{ playerId: 'p_yo' }]
    }]).linea;
    const { linea } = correr([{ tipo: 'pares', pares: { p_ana: 'negociando' } }], solo);
    expect(linea.estado).toBe('enlazando');
  });

  /**
   * Quedarse solo en la MESA no cuelga a nadie: el canal sigue abierto y puede
   * volver a entrar quien quiera. (En una línea privada lo mismo significa lo
   * contrario, y por eso son dos ramas: ahí quedarse solo es que el otro colgó.)
   */
  it('quedarse solo en la MESA no cierra la línea, la deja abierta y vacía', () => {
    const mesa = { ...enLlamada('abierta'), contexto: { tipo: 'mesa', roomId: 'ABCD' } };
    const { linea } = correr([{
      tipo: 'voice_pool_updated', poolId: 'tvoice_ABCD',
      contexto: { tipo: 'mesa', roomId: 'ABCD' },
      miembros: [{ playerId: 'p_yo' }]
    }], mesa);
    expect(linea).toMatchObject({ estado: 'abierta', motivo: null });
  });

  it('voice_pool_left traduce los tres motivos del servidor', () => {
    expect(correr([{ tipo: 'voice_pool_left', poolId: 'pool1', motivo: 'linea_vacia' }], enLlamada()).linea.motivo)
      .toBe('colgado_por_el_otro');
    expect(correr([{ tipo: 'voice_pool_left', poolId: 'pool1', motivo: 'fuera_de_la_mesa' }], enLlamada()).linea.motivo)
      .toBe('colgado_por_mi');
  });

  it('colgar emite end_call sin poolId, que ahora lo deriva el servidor', () => {
    const { linea, efectos } = correr([{ tipo: 'colgar' }], enLlamada());
    expect(cargaDe(efectos, 'end_call')).toEqual({});
    expect(linea).toMatchObject({ estado: 'cerrada', motivo: 'colgado_por_mi' });
  });

  it('cambiar a la voz de la mesa sale y entra, en ese orden', () => {
    const { linea, efectos } = correr([{ tipo: 'cambiarALaMesa' }], enLlamada());
    expect(emitidos(efectos)).toEqual(['end_call', 'join_table_voice']);
    expect(linea.estado).toBe('enlazando');
  });

  it('pedir la mesa con la línea abierta NO rehace el ciclo del micro', () => {
    const { linea, efectos } = correr([{ tipo: 'entrarAMesa' }], enLlamada());
    expect(emitidos(efectos)).toEqual(['join_table_voice']);
    expect(linea.estado).toBe('abierta');
    expect(efectos.some(e => e.tipo === 'pedirMicro')).toBe(false);
  });
});

describe('maquina · la calidad manda sobre el estado global', () => {
  it('resumenDePares cuenta lo que hay que contar', () => {
    expect(resumenDePares({ a: 'enlazado_bien', b: 'sin_ruta', c: 'ido', d: 'ausente', e: 'inestable' }))
      .toEqual({ total: 4, conectados: 1, inestables: 1, sinRuta: 1, ausentes: 1 });
  });

  /**
   * `abierta` EXIGE un par enlazado, y `enlazado_*` exige bytes de audio medidos.
   * `inestable` no cuenta: la mitad de las veces es ICE en 'disconnected', donde
   * no entra ni un byte. La versión anterior lo contaba como enlazado, así que un
   * único par desconectado bastaba para anunciar «Línea abierta».
   */
  it('un par inestable a solas es fragil, NUNCA abierta', () => {
    expect(correr([{ tipo: 'pares', pares: { p_ana: 'inestable' } }], enLlamada('enlazando')).linea.estado)
      .toBe('fragil');
    expect(correr([{ tipo: 'pares', pares: { p_ana: 'inestable' } }], enLlamada()).linea.estado)
      .toBe('fragil');
  });

  it('uno enlazado y otro inestable también es fragil', () => {
    const { linea } = correr([{ tipo: 'pares', pares: { p_ana: 'enlazado_bien', p_luis: 'inestable' } }], enLlamada());
    expect(linea.estado).toBe('fragil');
  });

  it('enlazando pasa a abierta en cuanto UN par enlaza', () => {
    const { linea } = correr([{ tipo: 'pares', pares: { p_ana: 'enlazado_justo' } }], enLlamada('enlazando'));
    expect(linea.estado).toBe('abierta');
  });

  it('enlazando pasa a sinRuta sólo si TODOS fracasan', () => {
    const dos = { ...enLlamada('enlazando'), miembros: [{ playerId: 'p_yo' }, { playerId: 'p_ana' }, { playerId: 'p_luis' }] };
    expect(correr([{ tipo: 'pares', pares: { p_ana: 'sin_ruta', p_luis: 'probando' } }], dos).linea.estado)
      .toBe('enlazando');
    expect(correr([{ tipo: 'pares', pares: { p_ana: 'sin_ruta', p_luis: 'sin_ruta' } }], dos).linea.estado)
      .toBe('sinRuta');
  });

  it('abierta con uno caído y otro vivo es fragil, no una llamada rota', () => {
    const { linea } = correr([{ tipo: 'pares', pares: { p_ana: 'enlazado_bien', p_luis: 'sin_ruta' } }], enLlamada());
    expect(linea.estado).toBe('fragil');
  });

  it('fragil vuelve a abierta cuando todos vuelven, y a sinRuta cuando caen todos', () => {
    const fragil = enLlamada('fragil');
    expect(correr([{ tipo: 'pares', pares: { p_ana: 'enlazado_bien' } }], fragil).linea.estado).toBe('abierta');
    expect(correr([{ tipo: 'pares', pares: { p_ana: 'sin_ruta', p_luis: 'sin_ruta' } }], fragil).linea.estado).toBe('sinRuta');
  });

  it('sinRuta NO es terminal: un par que conecta tarde devuelve la línea', () => {
    const { linea } = correr([{ tipo: 'pares', pares: { p_ana: 'enlazado_justo' } }], enLlamada('sinRuta'));
    expect(linea.estado).toBe('abierta');
  });

  it('reintentar desde sinRuta reinicia el ICE y vuelve a enlazando', () => {
    const { linea, efectos } = correr([{ tipo: 'reintentar' }], enLlamada('sinRuta'));
    expect(linea.estado).toBe('enlazando');
    expect(efectos.some(e => e.tipo === 'reiniciarIce')).toBe(true);
  });
});

describe('maquina · el reenganche, que es el fallo número uno en móvil', () => {
  it('perder el socket lleva a recuperando, no a colgado', () => {
    const { linea } = correr([{ tipo: 'desconectado' }], enLlamada());
    expect(linea.estado).toBe('recuperando');
    expect(linea.poolId).toBe('pool1');
  });

  it('un voice_state con pool devuelve la línea a enlazando', () => {
    const cayendo = correr([{ tipo: 'desconectado' }], enLlamada()).linea;
    const { linea } = correr([{
      tipo: 'voice_state',
      pool: { poolId: 'pool1', contexto: { tipo: 'privado' }, miembros: [{ playerId: 'p_yo' }, { playerId: 'p_ana' }] },
      enOtraPestana: false, timbrando: []
    }], cayendo);
    expect(linea.estado).toBe('enlazando');
    expect(linea.miembros).toHaveLength(2);
  });

  it('voice_state sin pool durante el reenganche cierra con sesion_perdida', () => {
    const cayendo = correr([{ tipo: 'desconectado' }], enLlamada()).linea;
    const { linea } = correr([{ tipo: 'voice_state', pool: null, enOtraPestana: false }], cayendo);
    expect(linea).toMatchObject({ estado: 'cerrada', motivo: 'sesion_perdida' });
  });

  it('agotar el plazo de reenganche también cierra con sesion_perdida', () => {
    const cayendo = correr([{ tipo: 'desconectado' }], enLlamada()).linea;
    expect(correr([{ tipo: 'recuperandoTope' }], cayendo).linea.motivo).toBe('sesion_perdida');
  });

  it('un voice_state normal no toca una línea sana, sólo la otra pestaña', () => {
    const { linea } = correr([{ tipo: 'voice_state', pool: null, enOtraPestana: true, timbrando: [] }], enLlamada());
    expect(linea.estado).toBe('abierta');
    expect(linea.enOtraPestana).toBe(true);
  });

  it('el aviso de «estás en otra pestaña» sólo sale estando en reposo', () => {
    const { efectos } = correr([{ tipo: 'voice_state', pool: null, enOtraPestana: true }]);
    expect(avisos(efectos)).toEqual(['linea.enOtraPestana']);
  });
});

describe('maquina · el resumen de cierre', () => {
  it('la línea cerrada vuelve sola a inactiva y se lleva el pool', () => {
    const cerrada = correr([{ tipo: 'colgar' }], enLlamada()).linea;
    const { linea } = correr([{ tipo: 'cerradaVista' }], cerrada);
    expect(linea).toMatchObject({ estado: 'inactiva', motivo: null, poolId: null });
    expect(linea.miembros).toEqual([]);
  });

  it('desde cerrada se puede volver a llamar sin pasar por inactiva', () => {
    const cerrada = correr([{ tipo: 'call_declined' }],
      correr([{ tipo: 'llamar', a: 'p_ana' }, { tipo: 'microListo' }]).linea).linea;
    expect(correr([{ tipo: 'llamar', a: 'p_ana' }], cerrada).linea.estado).toBe('pidiendoMicro');
  });

  it('un suceso desconocido no mueve nada (y devuelve el MISMO objeto)', () => {
    const antes = enLlamada();
    const { linea, efectos } = reducir(antes, { tipo: 'algo_que_no_existe' });
    expect(linea).toBe(antes);
    expect(efectos).toEqual([]);
  });

  it('EN_LLAMADA es la lista que gobierna «hay algo que mantener»', () => {
    expect(EN_LLAMADA).toEqual(['enlazando', 'abierta', 'fragil', 'sinRuta', 'recuperando']);
  });
});
