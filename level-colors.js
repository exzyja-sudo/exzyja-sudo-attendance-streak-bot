const LEVEL_COLORS = [
  0x2d9cdb,
  0x27ae60,
  0xf2994a,
  0xeb5757,
  0x9b51e0,
  0x00a896,
  0xe84393,
  0x546e7a,
  0x6c9a3f,
  0xd35400,
  0x4f6bed,
  0x7d3c98,
];

function getLevelColor(level) {
  if (!Number.isSafeInteger(level) || level < 1) {
    throw new RangeError('Level color requires a positive safe integer.');
  }
  return LEVEL_COLORS[(level - 1) % LEVEL_COLORS.length];
}

module.exports = { getLevelColor };