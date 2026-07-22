const { z } = require('zod');

const createRoomSchema = z.object({
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
  isBlitzMode: z.boolean().optional(),
  ranked: z.boolean().optional()
});

const quickPlaySchema = z.object({
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
  text: z.string().optional(),
  type: z.string().optional()
});

const voiceCamSchema = z.object({
  on: z.boolean().optional()
});

const voiceSignalSchema = z.object({
  to: z.string().trim().min(1),
  data: z.any()
});

const voiceSpeakingSchema = z.object({
  speaking: z.boolean().optional()
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
  voiceCamSchema,
  voiceSignalSchema,
  voiceSpeakingSchema,
  validate
};
