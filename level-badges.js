const zlib = require('node:zlib');
const { PermissionFlagsBits } = require('discord.js');

const BADGE_SIZE = 64;
const DIGITS = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
};

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
  return chunk;
}

function levelColor(level) {
  const hue = (level * 47) % 360;
  const chroma = 0.72 * (1 - Math.abs(2 * 0.46 - 1));
  const section = hue / 60;
  const secondary = chroma * (1 - Math.abs((section % 2) - 1));
  const rgb = section < 1 ? [chroma, secondary, 0]
    : section < 2 ? [secondary, chroma, 0]
      : section < 3 ? [0, chroma, secondary]
        : section < 4 ? [0, secondary, chroma]
          : section < 5 ? [secondary, 0, chroma]
            : [chroma, 0, secondary];
  const offset = 0.46 - chroma / 2;
  return rgb.map(channel => Math.round((channel + offset) * 255));
}

function createLevelBadgeIcon(level) {
  if (!Number.isSafeInteger(level) || level < 1) {
    throw new RangeError('Level badge must use a positive safe integer.');
  }

  const pixels = Buffer.alloc(BADGE_SIZE * BADGE_SIZE * 4);
  const [red, green, blue] = levelColor(level);
  const text = String(level);
  const gap = 1;
  const textWidth = text.length * 5 + (text.length - 1) * gap;
  const scale = Math.max(1, Math.min(6, Math.floor(48 / textWidth), Math.floor(46 / 7)));
  const scaledWidth = textWidth * scale;
  const scaledHeight = 7 * scale;
  const startX = Math.floor((BADGE_SIZE - scaledWidth) / 2);
  const startY = Math.floor((BADGE_SIZE - scaledHeight) / 2);

  function setPixel(x, y, color) {
    const offset = (y * BADGE_SIZE + x) * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = 255;
  }

  for (let y = 0; y < BADGE_SIZE; y += 1) {
    for (let x = 0; x < BADGE_SIZE; x += 1) {
      const distance = Math.hypot(x - 31.5, y - 31.5);
      if (distance <= 29) setPixel(x, y, [red, green, blue]);
      else if (distance <= 31) setPixel(x, y, [25, 30, 36]);
    }
  }

  let digitX = startX;
  for (const digit of text) {
    const glyph = DIGITS[digit];
    for (let y = 0; y < glyph.length; y += 1) {
      for (let x = 0; x < glyph[y].length; x += 1) {
        if (glyph[y][x] !== '1') continue;
        for (let offsetY = 0; offsetY < scale; offsetY += 1) {
          for (let offsetX = 0; offsetX < scale; offsetX += 1) {
            setPixel(digitX + x * scale + offsetX, startY + y * scale + offsetY, [255, 255, 255]);
          }
        }
      }
    }
    digitX += (5 + gap) * scale;
  }

  const scanlines = Buffer.alloc(BADGE_SIZE * (BADGE_SIZE * 4 + 1));
  for (let y = 0; y < BADGE_SIZE; y += 1) {
    const rowStart = y * (BADGE_SIZE * 4 + 1);
    scanlines[rowStart] = 0;
    pixels.copy(scanlines, rowStart + 1, y * BADGE_SIZE * 4, (y + 1) * BADGE_SIZE * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(BADGE_SIZE, 0);
  header.writeUInt32BE(BADGE_SIZE, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const lastWarningAt = new Map();

function warn(guildId, error) {
  const now = Date.now();
  if (now - (lastWarningAt.get(guildId) || 0) < 15 * 60 * 1000) return;
  lastWarningAt.set(guildId, now);
  console.error(`[level-badge] Could not sync a level badge in guild ${guildId}:`, error.message);
}

async function syncLevelBadge(member, level, database) {
  if (!member?.guild || !Number.isSafeInteger(level) || level < 1) return false;

  const { guild } = member;
  try {
    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      warn(guild.id, new Error('The bot needs Manage Roles permission.'));
      return false;
    }
    if (member.id === guild.ownerId || member.manageable === false) {
      warn(guild.id, new Error('The member is above the bot in the role hierarchy.'));
      return false;
    }

    const roleIds = database.getLevelBadgeRoles(guild.id).map(row => row.role_id);
    const storedRoleId = database.getLevelBadgeRoleId(guild.id, level);
    let role = storedRoleId
      ? guild.roles.cache.get(storedRoleId) || await guild.roles.fetch(storedRoleId).catch(() => null)
      : null;

    if (!role) {
      if (guild.roles.cache.size >= 250) {
        warn(guild.id, new Error("The server has reached Discord's role limit."));
        return false;
      }
      role = await guild.roles.create({
        name: `Level ${level}`,
        icon: createLevelBadgeIcon(level),
        reason: `Automatic badge for reaching level ${level}`,
      });
      database.setLevelBadgeRole(guild.id, level, role.id);
      roleIds.push(role.id);
    }

    if (role.editable === false) {
      warn(guild.id, new Error(`Role ${role.name} is above the bot in the role hierarchy.`));
      return false;
    }

    if (!member.roles.cache.has(role.id)) await member.roles.add(role);
    const previousRoleIds = roleIds.filter(roleId => roleId !== role.id && member.roles.cache.has(roleId));
    if (previousRoleIds.length) await member.roles.remove(previousRoleIds);
    return true;
  } catch (error) {
    warn(guild.id, error);
    return false;
  }
}

module.exports = { createLevelBadgeIcon, syncLevelBadge };