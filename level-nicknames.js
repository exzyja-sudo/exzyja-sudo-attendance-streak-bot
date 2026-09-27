const { PermissionFlagsBits } = require('discord.js');

const MAX_NICKNAME_LENGTH = 32;
const lastWarningAt = new Map();

function buildLevelNickname(baseName, level) {
  const suffix = `⭐ ${level}`;
  const maxBaseLength = MAX_NICKNAME_LENGTH - suffix.length - 1;
  const trimmedBase = Array.from(String(baseName || 'Member').trim())
    .slice(0, Math.max(1, maxBaseLength))
    .join('')
    .trimEnd();
  return `${trimmedBase || 'Member'} ${suffix}`;
}

function warn(guildId, message) {
  const now = Date.now();
  if (now - (lastWarningAt.get(guildId) || 0) < 15 * 60 * 1000) return;
  lastWarningAt.set(guildId, now);
  console.error(`[level-nickname] Could not sync a level nickname in guild ${guildId}:`, message);
}

async function syncLevelNickname(member, level, database) {
  if (!member?.guild || !Number.isSafeInteger(level) || level < 1 || member.user?.bot) return false;

  const { guild } = member;
  if (!database.getLevelNicknameEnabled(guild.id)) return false;

  try {
    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageNicknames)) {
      warn(guild.id, 'The bot needs Manage Nicknames permission.');
      return false;
    }
    if (member.id === guild.ownerId || member.manageable === false) {
      warn(guild.id, 'The member is above the bot in the role hierarchy.');
      return false;
    }

    const previous = database.getLevelNickname(guild.id, member.id);
    const currentName = member.nickname || member.displayName || member.user.username;
    let baseName;
    if (previous && member.nickname === previous.managed_nickname) {
      baseName = previous.base_name;
    } else {
      baseName = currentName
        .replace(/\s+(?:Lvl \d+|ʟᴠʟ [⁰¹²³⁴⁵⁶⁷⁸⁹]+|⭐ \d+)$/u, '')
        .trimEnd() || member.user.username;
    }

    const nickname = buildLevelNickname(baseName, level);
    if (member.nickname !== nickname) {
      await member.setNickname(nickname, `Sync level ${level} in nickname`);
    }
    database.setLevelNickname(guild.id, member.id, baseName, nickname);

    const oldBadgeRoleIds = database.getLevelBadgeRoles(guild.id)
      .map(row => row.role_id)
      .filter(roleId => member.roles.cache.has(roleId));
    if (oldBadgeRoleIds.length) {
      try {
        await member.roles.remove(oldBadgeRoleIds, 'Replaced automatic level badge with nickname level');
      } catch (error) {
        warn(guild.id, `Could not remove an old level badge role: ${error.message}`);
      }
    }
    return true;
  } catch (error) {
    warn(guild.id, error.message);
    return false;
  }
}

module.exports = { buildLevelNickname, syncLevelNickname };