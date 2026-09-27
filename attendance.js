const { EmbedBuilder } = require('discord.js');
const db = require('./db');
const { todayStr, dateStrPlusDays, monthStr, getStreakTier, getFireIcon, ANSI_RESET } = require('./utils');
const { version } = require('./package.json');

const CHECK_EMOJI = '✅';
const SHIELD_EMOJI = '🛡️';

// Fixed-width name column (monospace font in ```ansi blocks) so the streak
// and shield columns line up even when names differ a lot in length.
const NAME_COL_WIDTH = 18;

// Discord hard-caps a single embed field value at 1024 characters. A long
// checked-in list (many people, or long names) can blow past that and get
// silently cut off. FIELD_CHAR_BUDGET leaves headroom for the ```ansi fence
// itself; MAX_CHECKIN_FIELDS caps how many continuation fields we'll add so
// one huge server doesn't spam a dozen fields onto the embed.
const FIELD_CHAR_BUDGET = 1000;
const MAX_CHECKIN_FIELDS = 4;

function hasExemptionRole(member, exemptionRoleIds) {
  if (!exemptionRoleIds) return false;
  const roleIds = exemptionRoleIds.split(/[\s,]+/).filter(Boolean);
  return roleIds.some(roleId => member.roles.cache.has(roleId));
}

/**
 * Removes managed level badges from attendance names before applying the
 * fixed width, since they are not part of the attendance display.
 */
function padName(name) {
  const cleanName = name
    .replace(/\s+(?:Lvl\s+(?:\d+|[⁰¹²³⁴⁵⁶⁷⁸⁹]+)|ʟᴠʟ\s+[⁰¹²³⁴⁵⁶⁷⁸⁹]+|⭐\s*\d+)$/u, '')
    .replace(/⭐/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const trimmed = cleanName.length > NAME_COL_WIDTH
    ? cleanName.slice(0, NAME_COL_WIDTH - 1) + '…'
    : cleanName;
  return trimmed.padEnd(NAME_COL_WIDTH, ' ');
}

function renderCheckinLine({ name, streak, shieldsLeft }) {
  const tier = getStreakTier(streak);
  const fire = getFireIcon(tier);
  const namePart = padName(name);
  const streakPart = streak > 0
    ? `${tier.ansi}${fire} ${String(streak).padStart(3, ' ')}${ANSI_RESET}`
    : ' '.repeat(6);
  const shieldPart = streak > 0 ? `   ${SHIELD_EMOJI} ${shieldsLeft}` : '';
  return `${namePart} ${streakPart}${shieldPart}`;
}

/**
 * Splits rendered lines into chunks that each fit inside one embed field
 * (accounting for the ```ansi fence overhead), capped at MAX_CHECKIN_FIELDS
 * chunks. Returns { chunks, overflowCount } — overflowCount is how many
 * entries didn't fit in any chunk at all (only possible on very large
 * servers), so the caller can note "+N more" instead of losing them silently.
 */
function chunkCheckinLines(lines) {
  const chunks = [];
  let current = [];
  let currentLen = 0;

  for (const line of lines) {
    const lineLen = line.length + 1; // + newline
    if (currentLen + lineLen > FIELD_CHAR_BUDGET && current.length) {
      chunks.push(current);
      current = [];
      currentLen = 0;
      if (chunks.length === MAX_CHECKIN_FIELDS) break;
    }
    current.push(line);
    currentLen += lineLen;
  }
  if (chunks.length < MAX_CHECKIN_FIELDS && current.length) {
    chunks.push(current);
  }

  const usedLines = chunks.reduce((sum, c) => sum + c.length, 0);
  const overflowCount = lines.length - usedLines;
  return { chunks, overflowCount };
}

/**
 * Builds the daily attendance embed, including a live list of who has
 * checked in so far today. `entries` is an array of
 * { name, streak, shieldsLeft } already resolved by the caller, so every
 * reactor sees their fire streak + shields left right on the post — no
 * need to run /my-streak.
 */
function buildDailyEmbed(guildConfig, dateStr, entries) {
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(guildConfig.title)
    .setDescription(guildConfig.body)
    .setFooter({ text: `React with ✅ to check in today • v${version}` })
    .setTimestamp(new Date());

  if (entries.length === 0) {
    embed.addFields({
      name: `✅ Checked in (0)`,
      value: '_No one yet — be the first!_',
    });
    return embed;
  }

  const lines = entries.map(renderCheckinLine);
  const { chunks, overflowCount } = chunkCheckinLines(lines);

  chunks.forEach((chunk, i) => {
    embed.addFields({
      name: i === 0 ? `✅ Checked in (${entries.length})` : '↳ continued',
      value: '```ansi\n' + chunk.join('\n') + '\n```',
    });
  });

  if (overflowCount > 0) {
    embed.addFields({
      name: '↳ continued',
      value: `_+${overflowCount} more checked in — see \`/streaks\` for the full list._`,
    });
  }

  return embed;
}

function getMemberRoleSnapshot(member) {
  if (!member || !member.roles || !member.roles.cache) return [];
  return member.roles.cache
    .filter(role => role.id !== member.guild.id && !role.managed)
    .map(role => role.id);
}

async function saveCurrentMemberRoles(member, config) {
  if (!member || !member.roles || !member.roles.cache) return false;
  if (config.role_automation_enabled !== 1 || !config.inactive_role_id) return false;
  if (hasExemptionRole(member, config.exemption_role_id)) return false;

  const snapshot = getMemberRoleSnapshot(member);
  if (!snapshot.length) return false;

  db.saveRoleSnapshot(member.guild.id, member.id, snapshot);
  return true;
}

async function updateAttendanceRoles(member, config, inactive) {
  if (!member) {
    console.warn('[roles] Cannot update roles: member could not be fetched.');
    return false;
  }
  if (config.role_automation_enabled !== 1 || !config.inactive_role_id) {
    console.warn(`[roles] Skipping ${member.user.tag}: automation is disabled or no inactive role is configured.`);
    return false;
  }
  if (hasExemptionRole(member, config.exemption_role_id)) {
    console.log(`[roles] Skipping exempt member ${member.user.tag}.`);
    return false;
  }

  try {
    const currentSnapshot = getMemberRoleSnapshot(member);
    const savedRoleIds = db.getRoleSnapshot(member.guild.id, member.id) || currentSnapshot;

    if (inactive) {
      const snapshotToProtect = savedRoleIds.length ? savedRoleIds : currentSnapshot;
      const rolesToRemove = Array.from(new Set([
        ...snapshotToProtect,
        ...currentSnapshot,
        ...(config.active_role_id ? [config.active_role_id] : []),
      ])).filter(roleId => roleId && roleId !== config.inactive_role_id);

      for (const roleId of rolesToRemove) {
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId);
        }
      }

      if (config.inactive_role_id && !member.roles.cache.has(config.inactive_role_id)) {
        await member.roles.add(config.inactive_role_id);
      }

      db.saveRoleSnapshot(member.guild.id, member.id, snapshotToProtect);
      return true;
    }

    if (config.inactive_role_id && member.roles.cache.has(config.inactive_role_id)) {
      await member.roles.remove(config.inactive_role_id);
    }

    const restoredRoles = db.getRoleSnapshot(member.guild.id, member.id) || [];
    for (const roleId of restoredRoles) {
      if (roleId !== config.inactive_role_id && !member.roles.cache.has(roleId)) {
        await member.roles.add(roleId);
      }
    }

    if (config.active_role_id && !member.roles.cache.has(config.active_role_id)) {
      await member.roles.add(config.active_role_id);
    }

    db.removeRoleSnapshot(member.guild.id, member.id);
    return true;
  } catch (err) {
    console.error(`[roles] Failed to update ${member.user.tag}:`, err.message);
    return false;
  }
}

async function forgiveInactiveRole(member, config) {
  if (!member || !config?.inactive_role_id) {
    return { ok: false, reason: 'missing-config' };
  }
  if (hasExemptionRole(member, config.exemption_role_id)) {
    return { ok: false, reason: 'exempt' };
  }

  const roleIds = db.getRoleSnapshot(member.guild.id, member.id);

  try {
    if (config.inactive_role_id && member.roles.cache.has(config.inactive_role_id)) {
      await member.roles.remove(config.inactive_role_id);
    }

    if (Array.isArray(roleIds)) {
      for (const roleId of roleIds) {
        if (roleId !== config.inactive_role_id && !member.roles.cache.has(roleId)) {
          await member.roles.add(roleId);
        }
      }
    }

    if (config.active_role_id && !member.roles.cache.has(config.active_role_id)) {
      await member.roles.add(config.active_role_id);
    }

    db.removeRoleSnapshot(member.guild.id, member.id);
    return { ok: true, restoredRoles: Array.isArray(roleIds) && roleIds.length > 0 };
  } catch (err) {
    console.error(`[roles] Failed to forgive ${member.user.tag}:`, err.message);
    return { ok: false, reason: 'error' };
  }
}

async function postAttendance(client, guildConfig) {
  const channel = await client.channels.fetch(guildConfig.channel_id).catch(() => null);
  if (!channel) {
    console.error(`[attendance] Could not fetch channel ${guildConfig.channel_id} for guild ${guildConfig.guild_id}`);
    return;
  }

  const dateStr = todayStr(guildConfig.timezone);

  // Before posting today's new message, finalize yesterday's attendance:
  // anyone who didn't check in gets auto-shielded (if eligible) or reset.
  const prevActive = db.getActiveMessage(guildConfig.guild_id);
  if (prevActive && prevActive.attendance_date && prevActive.attendance_date !== dateStr) {
    const prevDate = prevActive.attendance_date;
    const prevBeforeThat = dateStrPlusDays(prevDate, -1);
    const monthKey = monthStr(prevDate);
    const results = db.processAbsences(guildConfig.guild_id, prevDate, prevBeforeThat, monthKey);
    for (const r of results) {
      if (r.status === 'reset') {
        const guild = client.guilds.cache.get(guildConfig.guild_id);
        const member = guild ? await guild.members.fetch(r.userId).catch(() => null) : null;
        if (member) {
          await saveCurrentMemberRoles(member, guildConfig);
        }
        const roleUpdated = await updateAttendanceRoles(member, guildConfig, true);
        if (!roleUpdated) {
          console.warn(`[roles] Reset recorded for ${r.userId}, but inactive-role update did not complete.`);
        } else if (r.previousStreak > 0 && guildConfig.announcement_channel_id) {
          const announcementChannel = await client.channels.fetch(guildConfig.announcement_channel_id).catch(() => null);
          if (announcementChannel) {
            const inactiveRoleText = guildConfig.inactive_role_id ? ` and assigned <@&${guildConfig.inactive_role_id}>` : '';
            const notice = new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle('⚠️ ON HOLD NOTICE')
              .setDescription([
                `<@${r.userId}>`,
                '',
                '```ansi',
                '\u001b[1;31mFAILED TO FOLLOW ATTENDANCE RULES\u001b[0m',
                '',
                `Temporarily moved to ON HOLD${inactiveRoleText} because attendance was missed.`,
                '```',
              ].join('\n'))
              .setFooter({ text: 'Automatic inactive status' })
              .setTimestamp();
            const payload = guildConfig.inactive_role_id
              ? {
                  content: `<@&${guildConfig.inactive_role_id}>`,
                  embeds: [notice],
                  allowedMentions: { roles: [guildConfig.inactive_role_id] },
                }
              : { embeds: [notice] };
            await announcementChannel.send(payload).catch(err =>
              console.error(`[announcement] Failed to notify ${r.userId}:`, err.message)
            );
          } else {
            console.warn(`[announcement] Could not fetch channel ${guildConfig.announcement_channel_id}.`);
          }
        } else {
          console.log(`[announcement] No announcement channel configured for ${r.userId}.`);
        }
      }
      if (r.status === 'shielded') {
        console.log(`[shield] user ${r.userId} in guild ${guildConfig.guild_id} auto-shielded (${r.shieldsLeft} left this month)`);
      } else {
        console.log(`[streak] user ${r.userId} in guild ${guildConfig.guild_id} streak reset (was ${r.previousStreak})`);
      }
    }
  }

  const embed = buildDailyEmbed(guildConfig, dateStr, []);
  const message = await channel.send({ content: '@everyone', embeds: [embed] });
  db.setActiveMessage(guildConfig.guild_id, message.id, channel.id, dateStr);
  await message.react(CHECK_EMOJI);

  return message;
}

async function buildLeaderboardEmbed(guild, limit = 25) {
  const rows = db.getLeaderboard(guild.id, limit);
  const currentMonth = monthStr(todayStr('UTC'));

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('🔥 Attendance Streaks')
    .setTimestamp(new Date());

  if (rows.length === 0) {
    embed.setDescription('No active streaks yet — react to today\'s attendance post to start one!');
    return embed;
  }

  const lines = await Promise.all(
    rows.map(async (row, i) => {
      const member = await guild.members.fetch(row.user_id).catch(() => null);
      const rawName = member ? member.displayName : `Unknown user (${row.user_id})`;
      const name = padName(`${i + 1}. ${rawName}`);
      const shieldsLeft = db.shieldsRemaining(row, currentMonth);
      const tier = getStreakTier(row.current_streak);
      const fire = getFireIcon(tier);

      if (row.shielded_date) {
        // Currently sitting on an auto-shielded absence, waiting for them to check back in.
        return `${name} ${SHIELD_EMOJI} paused (${tier.ansi}${fire} ${row.current_streak}${ANSI_RESET} kept, ${shieldsLeft} shield${shieldsLeft === 1 ? '' : 's'} left)`;
      }
      return `${name} ${tier.ansi}${fire} ${String(row.current_streak).padStart(3, ' ')}${ANSI_RESET} day${row.current_streak === 1 ? '' : 's'}   (best: ${row.longest_streak},  ${SHIELD_EMOJI} ${shieldsLeft} left)`;
    })
  );

  embed.setDescription('```ansi\n' + lines.join('\n') + '\n```');
  return embed;
}

module.exports = { postAttendance, buildLeaderboardEmbed, buildDailyEmbed, saveCurrentMemberRoles, updateAttendanceRoles, forgiveInactiveRole, CHECK_EMOJI, SHIELD_EMOJI };
