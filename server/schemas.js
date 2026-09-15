const { z } = require('zod');

const createRoomSchema = z.object({
  gameType: z.string().optional(),
  name: z.string().trim().min(1, 'srv.err.nameRequired').max(30),
  playerId: z.string().optional(),
  maxPip: z.number().optional(),
  powersEnabled: z.boolean().optional(),
  teamsEnabled: z.boolean().optional(),
  drawEnabled: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  maxScore: z.number().nullable().optional(),
  powerIntensity: z.enum(['light', 'normal', 'chaos']).optional(),
  onePowerPerTurn: z.boolean().optional(),
  isBlitzMode: z.boolean().optional()
  // `ranked` NO se acepta del cliente: era la vía para saltarse el
  // emparejamiento y montar partidas clasificatorias a medida (farmeo de ELO
  // con dos pestañas). Solo `createRankedMatch`, desde la cola, crea ranked.
});

const quickPlaySchema = z.object({
  gameType: z.string().optional(),
  name: z.string().trim().min(1, 'srv.err.nameRequired').max(30),
  playerId: z.string().optional()
});

const joinRoomSchema = z.object({
  roomId: z.string().trim().min(1, 'srv.err.roomNotFound'),
  name: z.string().trim().optional(),
  playerId: z.string().optional()
});

const spectateRoomSchema = z.object({
  roomId: z.string().trim().min(1, 'srv.err.roomNotFound')
});

const leaveSpectateSchema = z.object({
  roomId: z.string().optional()
});

const addBotSchema = z.object({
  roomId: z.string().trim().min(1, 'srv.err.roomNotFound'),
  difficulty: z.string().optional()
});

const removeBotSchema = z.object({
  roomId: z.string().trim().min(1, 'srv.err.roomNotFound'),
  botId: z.string().trim().min(1)
});

const swapSeatsSchema = z.object({
  roomId: z.string().trim().min(1),
  playerA: z.string().trim().min(1),
  playerB: z.string().trim().min(1)
});

const kickPlayerSchema = z.object({
  targetId: z.string().trim().min(1)
});

const toggleReadySchema = z.object({
  roomId: z.string().trim().min(1),
  playerId: z.string().optional()
});

const playTileSchema = z.object({
  roomId: z.string().trim().min(1),
  playerId: z.string().trim().min(1),
  tileIndex: z.number().int().min(0),
  side: z.enum(['left', 'right']).optional().nullable()
});

const drawTileSchema = z.object({
  roomId: z.string().trim().min(1),
  playerId: z.string().trim().min(1)
});

const passTurnSchema = z.object({
  roomId: z.string().trim().min(1),
  playerId: z.string().trim().min(1)
});

const usePowerCardSchema = z.object({
  roomId: z.string().trim().min(1),
  playerId: z.string().trim().min(1),
  cardId: z.string().trim().min(1),
  targetId: z.any().nullable().optional(),
  tileIndex: z.number().nullable().optional()
});

const roomOnlySchema = z.object({
  roomId: z.string().trim().min(1)
});

const sendQuickMessageSchema = z.object({
  roomId: z.string().trim().min(1),
  playerId: z.string().optional(),
  // Cota de longitud: evita que el chat se use para inundar ancho de banda o
  // memoria de los clientes. React ya escapa el contenido (sin XSS).
  text: z.string().max(200).optional(),
  type: z.string().max(24).optional()
});

const sendEmoteSchema = z.object({
  roomId: z.string().trim().min(1),
  playerId: z.string().trim().min(1),
  emoji: z.string().trim().min(1).max(16),
  targetPlayerId: z.string().max(64).optional().nullable()
});

// ─── Voz ───
//
// Los tres esquemas anteriores (voiceCamSchema, voiceSignalSchema y
// voiceSpeakingSchema) se han retirado con los eventos que validaban.
// `voiceSignalSchema` era además inservible: declaraba `{ to, data }` mientras
// el payload real de la señalización es `{ toPlayerId, signal }`, así que
// enchufarlo habría rechazado el 100 % del tráfico WebRTC — sin error visible y
// sin log. Y su `z.any()` no validaba nada de lo que decía proteger.
//
// Los objetos EXTERNOS no son .strict() a propósito: durante la ventana de
// tolerancia el cliente antiguo sigue mandando `poolId` en `accept_call`,
// `end_call` y `voice_pool_signal`, y zod lo descarta en silencio en vez de
// rechazar el evento entero. Los topes de longitud sí son estrictos: lo que
// aquí pasa se reenvía tal cual al navegador de otra persona.

const vozLlamarSchema = z.object({
  targetPlayerId: z.string().trim().min(1).max(64)
});

const vozCallIdSchema = z.object({
  callId: z.string().trim().min(1).max(64)
});

const vozHablandoSchema = z.object({
  speaking: z.boolean()
});

const vozDispSchema = z.object({
  modo: z.enum(['libre', 'no_molestar'])
});

const vozParEstadoSchema = z.object({
  peerPlayerId: z.string().trim().min(1).max(64),
  estado: z.enum(['negociando', 'probando', 'enlazado_bien', 'enlazado_justo', 'inestable', 'sin_ruta'])
});

const vozSenalSchema = z.object({
  toPlayerId: z.string().trim().min(1).max(64),
  signal: z.union([
    z.object({
      description: z.object({
        type: z.enum(['offer', 'answer', 'pranswer', 'rollback']),
        sdp: z.string().max(20000).optional()
      })
    }),
    z.object({
      candidate: z.object({
        candidate: z.string().max(1000),
        sdpMid: z.string().max(64).nullable().optional(),
        sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
        usernameFragment: z.string().max(256).nullable().optional()
      })
    })
  ])
});

// Helper de validación
function validate(schema, data) {
  const result = schema.safeParse(data || {});
  if (!result.success) {
    const issue = result.error.issues[0];
    return { success: false, errorKey: issue?.message || 'srv.err.invalidData' };
  }
  return { success: true, data: result.data };
}

module.exports = {
  createRoomSchema,
  quickPlaySchema,
  joinRoomSchema,
  spectateRoomSchema,
  leaveSpectateSchema,
  addBotSchema,
  removeBotSchema,
  swapSeatsSchema,
  kickPlayerSchema,
  toggleReadySchema,
  playTileSchema,
  drawTileSchema,
  passTurnSchema,
  usePowerCardSchema,
  roomOnlySchema,
  sendQuickMessageSchema,
  sendEmoteSchema,
  vozLlamarSchema,
  vozCallIdSchema,
  vozHablandoSchema,
  vozDispSchema,
  vozParEstadoSchema,
  vozSenalSchema,
  validate
};
