require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { version } = require('./package.json');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  AuditLogEvent,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const cron = require('node-cron');

// Render and most PaaS hosts expect the service to bind to $PORT and respond
// to HTTP so they can health-check it. The bot itself only needs the Discord
// Gateway connection, so this is just a minimal "I'm alive" endpoint.
const PORT = process.env.PORT || 3000;
const webSessions = new Map();
const oauthStates = new Map();

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(cookie => {
    const separator = cookie.indexOf('=');
    return [cookie.slice(0, separator).trim(), decodeURIComponent(cookie.slice(separator + 1).trim())];
  }));
}

function getWebSession(req) {
  const sessionId = parseCookies(req).attendance_session;
  return sessionId ? webSessions.get(sessionId) : null;
}

function requireWebSession(req, res) {
  const session = getWebSession(req);
  if (!session) {
    sendJson(res, 401, { error: 'Sign in with Discord to continue.' });
    return null;
  }
  return session;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 100000) reject(new Error('Request body is too large.'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function normalizeAnnouncementText(value, maxLength = Infinity) {
  const normalized = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00A0/g, ' ')
    .trim();

  return normalized.slice(0, maxLength);
}

function parsePollDuration(value) {
  const match = /^([1-9]\d*)([smhd])$/i.exec(String(value || '').trim());
  if (!match) return null;
  const multipliers = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  const durationMs = Number(match[1]) * multipliers[match[2].toLowerCase()];
  return Number.isSafeInteger(durationMs) && durationMs <= 7 * 24 * 60 * 60 * 1000
    ? durationMs
    : null;
}

async function discordRequest(endpoint, options = {}) {
  const response = await fetch(`https://discord.com/api/v10${endpoint}`, options);
  const responseText = await response.text();
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const reason = payload.error_description || payload.message || payload.error || 'request failed';
    throw new Error(`Discord API ${response.status}: ${reason}`);
  }
  return payload;
}

function hasManageGuildPermission(guild) {
  return guild.owner || (BigInt(guild.permissions || 0) & 0x20n) === 0x20n;
}

function getAuthorizedGuild(session, guildId) {
  if (!session || session.expiresAt < Date.now()) return null;
  return session.guilds.find(guild => guild.id === guildId && hasManageGuildPermission(guild) && client.guilds.cache.has(guildId));
}

http
  .createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Attendance bot is running.\n');
      return;
    }

    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (requestUrl.pathname === '/auth/login') {
      if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !process.env.DISCORD_REDIRECT_URI) {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Web login is not configured. Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, and DISCORD_REDIRECT_URI.\n');
        return;
      }
      const state = crypto.randomBytes(24).toString('hex');
      oauthStates.set(state, Date.now() + 5 * 60 * 1000);
      const params = new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
        response_type: 'code',
        scope: 'identify guilds',
        state,
      });
      res.writeHead(302, { Location: `https://discord.com/oauth2/authorize?${params}` });
      res.end();
      return;
    }

    if (requestUrl.pathname === '/auth/callback') {
      if (requestUrl.searchParams.get('error')) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Discord authorization was cancelled. Please try again and click Authorize.\n');
        return;
      }
      const stateExpiry = oauthStates.get(requestUrl.searchParams.get('state'));
      oauthStates.delete(requestUrl.searchParams.get('state'));
      if (!stateExpiry || stateExpiry < Date.now() || !requestUrl.searchParams.get('code')) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid or expired login request.\n');
        return;
      }
      try {
        const tokenParams = new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code: requestUrl.searchParams.get('code'),
          redirect_uri: process.env.DISCORD_REDIRECT_URI,
        });
        const token = await discordRequest('/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenParams });
        const [user, guilds] = await Promise.all([
          discordRequest('/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } }),
          discordRequest('/users/@me/guilds', { headers: { Authorization: `Bearer ${token.access_token}` } }),
        ]);
        const sessionId = crypto.randomBytes(32).toString('hex');
        webSessions.set(sessionId, { user, guilds, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
        res.writeHead(302, { Location: '/dashboard.html#dashboard', 'Set-Cookie': `attendance_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800` });
        res.end();
      } catch (err) {
        console.error('[web-auth] login failed:', err.message);
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Discord login failed. Please try again.\n');
      }
      return;
    }

    if (requestUrl.pathname === '/auth/logout') {
      const sessionId = parseCookies(req).attendance_session;
      if (sessionId) webSessions.delete(sessionId);
      res.writeHead(302, { Location: '/', 'Set-Cookie': 'attendance_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
      res.end();
      return;
    }

    if (requestUrl.pathname === '/api/me') {
      const session = getWebSession(req);
      sendJson(res, 200, session ? { authenticated: true, user: session.user } : { authenticated: false });
      return;
    }

    if (requestUrl.pathname === '/api/version') {
      sendJson(res, 200, { version });
      return;
    }

    if (requestUrl.pathname === '/api/setup-guilds') {
      const session = requireWebSession(req, res);
      if (!session) return;
      if (session.expiresAt < Date.now()) {
        sendJson(res, 401, { error: 'Your session expired. Please sign in again.' });
        return;
      }
      const guilds = session.guilds.filter(hasManageGuildPermission).filter(guild => client.guilds.cache.has(guild.id)).map(guild => ({ id: guild.id, name: guild.name, icon: guild.icon }));
      sendJson(res, 200, { guilds });
      return;
    }

    if (requestUrl.pathname.startsWith('/api/setup-options/')) {
      const session = requireWebSession(req, res);
      if (!session) return;
      const guildId = requestUrl.pathname.split('/').pop();
      if (!getAuthorizedGuild(session, guildId)) {
        sendJson(res, 403, { error: 'You cannot configure this server.' });
        return;
      }
      const guild = client.guilds.cache.get(guildId);
      const channels = guild.channels.cache.filter(channel => channel.isTextBased() && !channel.isThread()).map(channel => ({ id: channel.id, name: channel.name })).sort((first, second) => first.name.localeCompare(second.name));
      const roles = guild.roles.cache.filter(role => !role.managed && role.id !== guildId).map(role => ({ id: role.id, name: role.name })).sort((first, second) => first.name.localeCompare(second.name));
      sendJson(res, 200, { channels, roles, config: db.getConfig(guildId) || null });
      return;
    }

    if (requestUrl.pathname === '/api/setup-config' && req.method === 'POST') {
      const session = requireWebSession(req, res);
      if (!session) return;
      try {
        const data = JSON.parse(await readRequestBody(req));
        const guildId = String(data.guildId || '');
        const authorizedGuild = getAuthorizedGuild(session, guildId);
        const guild = client.guilds.cache.get(guildId);
        if (!authorizedGuild || !guild) return sendJson(res, 403, { error: 'You cannot configure this server.' });
        const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(String(data.time || '').trim());
        const hour = timeMatch ? Number(timeMatch[1]) : -1;
        const minute = timeMatch ? Number(timeMatch[2]) : -1;
        if (hour > 23 || minute > 59 || hour < 0 || minute < 0) return sendJson(res, 400, { error: 'Use a valid 24-hour time such as 00:00.' });
        Intl.DateTimeFormat('en-US', { timeZone: String(data.timezone || '') });
        const channel = guild.channels.cache.get(String(data.channelId || ''));
        const announcementChannel = data.announcementChannelId ? guild.channels.cache.get(String(data.announcementChannelId)) : null;
        const activeRole = data.activeRoleId ? guild.roles.cache.get(String(data.activeRoleId)) : null;
        const inactiveRole = data.inactiveRoleId ? guild.roles.cache.get(String(data.inactiveRoleId)) : null;
        const exemptionRoleIds = parseExemptionRoleIds(Array.isArray(data.exemptionRoleIds) ? data.exemptionRoleIds.join(',') : data.exemptionRoleIds);
        if (!channel || !channel.isTextBased() || (announcementChannel && !announcementChannel.isTextBased()) || (activeRole && activeRole.managed) || (inactiveRole && inactiveRole.managed) || exemptionRoleIds.some(roleId => !guild.roles.cache.has(roleId))) return sendJson(res, 400, { error: 'Choose valid channels and roles from this server.' });
        if (data.roleAutomationEnabled && (!activeRole || !inactiveRole || activeRole.id === inactiveRole.id)) return sendJson(res, 400, { error: 'Choose two different active and inactive roles.' });
        const config = { channelId: channel.id, announcementChannelId: announcementChannel?.id || null, hour, minute, timezone: String(data.timezone), title: String(data.title || 'Daily Attendance').slice(0, 256), body: String(data.body || 'React with ✅ if you are online today.').slice(0, 4000), configuredDate: todayStr(String(data.timezone)), activeRoleId: data.roleAutomationEnabled ? activeRole.id : null, inactiveRoleId: data.roleAutomationEnabled ? inactiveRole.id : null, exemptionRoleId: data.roleAutomationEnabled ? exemptionRoleIds.join(',') || null : null, roleAutomationEnabled: data.roleAutomationEnabled ? 1 : 0 };
        db.setConfig(guildId, config);
        scheduleGuild({ guild_id: guildId, channel_id: config.channelId, announcement_channel_id: config.announcementChannelId, hour, minute, timezone: config.timezone, title: config.title, body: config.body, active_role_id: config.activeRoleId, inactive_role_id: config.inactiveRoleId, exemption_role_id: config.exemptionRoleId, role_automation_enabled: config.roleAutomationEnabled });
        sendJson(res, 200, { saved: true });
      } catch (err) {
        sendJson(res, 400, { error: err.message.includes('time zone') ? 'Use a valid IANA timezone such as Asia/Manila.' : 'Please check the form values and try again.' });
      }
      return;
    }

    if (req.url.split('?')[0] === '/api/servers') {
      const servers = client.guilds.cache.map(guild => ({
        name: guild.name,
        icon: guild.iconURL({ extension: 'png', size: 64 }),
        joinedTimestamp: guild.joinedTimestamp || Number.MAX_SAFE_INTEGER,
      })).sort((first, second) => first.joinedTimestamp - second.joinedTimestamp);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ count: servers.length, servers }));
      return;
    }

    const requestedPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
    const publicRoot = path.resolve(__dirname, 'public');
    const filePath = path.resolve(publicRoot, `.${requestedPath}`);
    const contentTypes = {
      '.css': 'text/css',
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
    };

    if (!filePath.startsWith(`${publicRoot}${path.sep}`) || !contentTypes[path.extname(filePath)]) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found.\n');
      return;
    }

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found.\n');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] });
      res.end(content);
    });
  })
  .listen(PORT, () => console.log(`[http] Health check server listening on port ${PORT}`));

const db = require('./db');
const { postAttendance, buildLeaderboardEmbed, buildDailyEmbed, saveCurrentMemberRoles, updateAttendanceRoles, forgiveInactiveRole, CHECK_EMOJI } = require('./attendance');
const { todayStr, yesterdayStr, monthStr, minutesSinceMidnight } = require('./utils');

const POLL_EMOJIS = ['🟢', '🔴'];
const MEETME_DURATION_MS = 20 * 60 * 1000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

// guildId -> node-cron task, so we can reschedule after /setup-attendance
const scheduledTasks = new Map();
const attendanceRefreshQueues = new Map();
let scheduledAnnouncementTask;
let pollTask;

function parseExemptionRoleIds(value) {
  if (!value) return [];
  return [...new Set(value.split(/[\s,]+/).map(role => {
    const mention = /^<@&(\d+)>$/.exec(role);
    return mention ? mention[1] : role;
  }))];
}

function scheduleGuild(config) {
  const existing = scheduledTasks.get(config.guild_id);
  if (existing) existing.stop();

  const cronExpr = `${config.minute} ${config.hour} * * *`;
  const task = cron.schedule(
    cronExpr,
    () => {
      postAttendance(client, config).catch(err =>
        console.error(`[cron] Failed to post attendance for guild ${config.guild_id}:`, err)
      );
    },
    { timezone: config.timezone || 'UTC' }
  );

  scheduledTasks.set(config.guild_id, task);
  console.log(`[schedule] Guild ${config.guild_id} -> daily at ${config.hour}:${String(config.minute).padStart(2, '0')} (${config.timezone})`);
}

function getLocalDateTime(timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

function isScheduledAnnouncementDue(schedule, local) {
  if (schedule.last_sent_date === local.date) return false;
  const scheduledDate = new Date(`${schedule.scheduled_date}T00:00:00Z`);
  const localDate = new Date(`${local.date}T00:00:00Z`);
  const dateMatches = schedule.recurrence === 'yearly'
    ? schedule.scheduled_date.slice(5) === local.date.slice(5)
    : schedule.recurrence === 'weekly'
      ? localDate >= scheduledDate && scheduledDate.getUTCDay() === localDate.getUTCDay()
      : schedule.recurrence === 'daily'
        ? localDate >= scheduledDate
        : schedule.scheduled_date === local.date;
  return dateMatches && local.minutes >= schedule.hour * 60 + schedule.minute;
}

async function publishScheduledAnnouncement(schedule) {
  const channel = await client.channels.fetch(schedule.channel_id).catch(() => null);
  if (!channel?.isTextBased()) {
    console.error(`[schedule] Channel ${schedule.channel_id} not found for announcement ${schedule.id}.`);
    return false;
  }

  let embed;
  if (schedule.kind === 'birthday') {
    const member = await client.guilds.cache.get(schedule.guild_id)?.members.fetch(schedule.user_id).catch(() => null);
    if (!member) {
      console.error(`[schedule] Birthday member ${schedule.user_id} not found for announcement ${schedule.id}.`);
      return false;
    }
    embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('🎉 Birthday Greetings!')
      .setDescription([
        `🎂 ${member} has a **Happy Birthday**!`,
        '',
        'Wishing you a fantastic day filled with joy, laughter, and plenty of cake! 🎉',
      ].join('\n'))
      .setTimestamp();
  } else {
    embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(`⚠️ ${schedule.title}`)
      .setDescription(`**${schedule.subject}**`)
      .addFields(
        { name: 'Details', value: schedule.message || 'No details provided.' },
        { name: 'Action Required', value: '⚠️ Reacting to this announcement is mandatory. Officers will know who has already read it.' },
      )
      .setFooter({ text: 'Please react with ✅ to confirm you have read this announcement.' });
  }

  const sentMessage = await channel.send({
    content: schedule.kind === 'general' ? '@everyone' : undefined,
    embeds: [embed],
    allowedMentions: schedule.kind === 'general' ? { parse: ['everyone'] } : undefined,
  }).catch(err => {
    console.error(`[schedule] Failed to send announcement ${schedule.id}:`, err.message);
    return null;
  });
  if (!sentMessage) return false;

  if (schedule.kind === 'general') await sentMessage.react('✅').catch(err =>
    console.error(`[schedule] Failed to add reaction for announcement ${schedule.id}:`, err.message)
  );
  return true;
}

async function processScheduledAnnouncements() {
  const schedules = db.getAllScheduledAnnouncements();
  for (const schedule of schedules) {
    let local;
    try {
      local = getLocalDateTime(schedule.timezone);
    } catch (err) {
      console.error(`[schedule] Invalid timezone for announcement ${schedule.id}:`, err.message);
      continue;
    }
    if (!isScheduledAnnouncementDue(schedule, local)) continue;

    const sent = await publishScheduledAnnouncement(schedule);
    if (sent) {
      db.markScheduledAnnouncementSent(schedule.id, local.date);
      console.log(`[schedule] Posted announcement ${schedule.id} for guild ${schedule.guild_id}.`);
    }
  }
}

async function closePoll(poll) {
  let options;
  try {
    options = JSON.parse(poll.options);
  } catch {
    console.error(`[poll] Invalid options for poll ${poll.id}.`);
    return false;
  }

  const pollChannel = await client.channels.fetch(poll.channel_id).catch(() => null);
  const outcomeChannel = await client.channels.fetch(poll.outcome_channel_id).catch(() => null);
  if (!pollChannel?.messages?.fetch || !outcomeChannel?.isTextBased()) {
    console.error(`[poll] Could not fetch channels for poll ${poll.id}.`);
    return false;
  }

  const message = await pollChannel.messages.fetch(poll.message_id).catch(() => null);
  if (!message) {
    console.error(`[poll] Could not fetch message for poll ${poll.id}.`);
    return false;
  }

  const votes = [];
  for (let index = 0; index < options.length; index += 1) {
    const reaction = message.reactions.cache.get(POLL_EMOJIS[index]);
    const users = reaction ? await reaction.users.fetch().catch(() => new Map()) : new Map();
    const voters = [...users.values()].filter(user => !user.bot);
    votes.push({ count: voters.length, voters: voters.map(user => `<@${user.id}>`) });
  }

  const highestVote = Math.max(...votes.map(vote => vote.count), 0);
  const winners = options.filter((option, index) => votes[index].count === highestVote && highestVote > 0);
  const resultLines = options.map((option, index) => {
    const vote = votes[index];
    const allVoters = vote.voters.length ? vote.voters.join(', ') : 'No voters';
    const voterText = allVoters.length > 900 ? `${allVoters.slice(0, 897)}...` : allVoters;
    return `${POLL_EMOJIS[index]} **${option}** — ${vote.count} vote${vote.count === 1 ? '' : 's'}\nVoters: ${voterText}`;
  });
  const outcome = winners.length
    ? winners.length === 1 ? `🏆 Winner: **${winners[0]}**` : `🤝 Tie: ${winners.map(winner => `**${winner}**`).join(', ')}`
    : 'No votes were recorded.';

  const resultEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📊 Poll Results')
    .setDescription([`**${poll.question}**`, '', ...resultLines, '', outcome].join('\n'))
    .setFooter({ text: `Poll #${poll.id} closed` })
    .setTimestamp();
  const sent = await outcomeChannel.send({ embeds: [resultEmbed] }).catch(err => {
    console.error(`[poll] Failed to announce result for poll ${poll.id}:`, err.message);
    return null;
  });
  if (!sent) return false;

  const closedEmbed = new EmbedBuilder()
    .setColor(0x747f8d)
    .setTitle('📊 Poll Closed')
    .setDescription([`**${poll.question}**`, '', ...resultLines, '', outcome].join('\n'))
    .setFooter({ text: `Results announced in <#${poll.outcome_channel_id}>` });
  await message.edit({ embeds: [closedEmbed] }).catch(err =>
    console.error(`[poll] Failed to close poll message ${poll.id}:`, err.message)
  );
  db.markPollClosed(poll.id);

  if (poll.access_role_id && pollChannel.permissionOverwrites) {
    const anotherActivePoll = db.hasActivePollForAccess(poll.channel_id, poll.access_role_id, poll.id);
    if (!anotherActivePoll) {
      await pollChannel.permissionOverwrites.edit(poll.access_role_id, { ViewChannel: false }).catch(err =>
        console.error(`[poll] Failed to hide channel for poll ${poll.id}:`, err.message)
      );
    }
  }
  return true;
}

async function processDuePolls() {
  for (const poll of db.getDuePolls()) {
    try {
      await closePoll(poll);
    } catch (err) {
      console.error(`[poll] Failed to close poll ${poll.id}:`, err);
    }
  }
}

async function processDueMeetmeAssignments() {
  for (const assignment of db.getDueMeetmeAssignments()) {
    try {
      const guild = client.guilds.cache.get(assignment.guild_id);
      const member = guild ? await guild.members.fetch(assignment.user_id).catch(() => null) : null;
      const role = guild ? await guild.roles.fetch(assignment.role_id).catch(() => null) : null;
      if (member && role && member.roles.cache.has(role.id)) {
        await member.roles.remove(role);
      }

      const config = db.getConfig(assignment.guild_id);
      const channel = config?.announcement_channel_id
        ? await client.channels.fetch(config.announcement_channel_id).catch(() => null)
        : null;
      if (channel?.isTextBased() && member) {
        const notice = new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle('🚪 Meeting Room Access Ended')
          .setDescription(`${member} has been removed from the Meeting room after 20 minutes.`)
          .setFooter({ text: 'MeetMe access expired' })
          .setTimestamp();
        await channel.send({ embeds: [notice] }).catch(err =>
          console.error(`[meetme] Failed to announce expiry for ${assignment.user_id}:`, err.message)
        );
      }
      db.markMeetmeAssignmentRemoved(assignment.id);
    } catch (err) {
      console.error(`[meetme] Failed to expire assignment ${assignment.id}:`, err);
    }
  }
}

// Re-renders the "Checked in (N)" list on today's attendance post to reflect
// current reactions — including each person's fire streak + shields left,
// so nobody needs to run /my-streak just to see it. Called after every add/remove.
async function getLiveCheckedInUserIds(message, guildId, dateStr) {
  const reaction = message.reactions.cache.get(CHECK_EMOJI);
  const reactionUsers = reaction ? await reaction.users.fetch().catch(() => new Map()) : new Map();
  const reactionIds = [...reactionUsers.keys()].filter(id => id !== message.author?.id);
  const databaseIds = db.getCheckins(guildId, dateStr);
  return [...new Set([...reactionIds, ...databaseIds])];
}

async function refreshAttendanceEmbed(message, config, guildId, dateStr) {
  const previousRefresh = attendanceRefreshQueues.get(message.id) || Promise.resolve();
  const currentRefresh = previousRefresh.catch(() => {}).then(async () => {
    // Read the check-ins after earlier refreshes finish so the final edit has
    // the complete current state, even when several reactions arrive together.
    const userIds = await getLiveCheckedInUserIds(message, guildId, dateStr);
    const guild = message.guild;
    const currentMonth = monthStr(dateStr);
    const entries = [];
    for (const uid of userIds) {
      const member = await guild.members.fetch(uid).catch(() => null);
      const name = member ? member.displayName : `Unknown user (${uid})`;
      const row = db.getStreak(guildId, uid);
      const streak = row ? row.current_streak : 0;
      const shieldsLeft = db.shieldsRemaining(row, currentMonth);
      entries.push({ name, streak, shieldsLeft });
    }
    const embed = buildDailyEmbed(config, dateStr, entries);
    await message.edit({ embeds: [embed] }).catch(err =>
      console.error('[embed] failed to refresh attendance post:', err)
    );
  });

  attendanceRefreshQueues.set(message.id, currentRefresh);
  try {
    await currentRefresh;
  } finally {
    if (attendanceRefreshQueues.get(message.id) === currentRefresh) {
      attendanceRefreshQueues.delete(message.id);
    }
  }
}

async function refreshActiveAttendanceEmbed(guildId, config) {
  const active = db.getActiveMessage(guildId);
  if (!active?.channel_id || !active.message_id) return;

  const channel = await client.channels.fetch(active.channel_id).catch(() => null);
  if (!channel?.messages?.fetch) return;

  const message = await channel.messages.fetch(active.message_id).catch(() => null);
  if (!message) return;

  const currentConfig = config || db.getConfig(guildId);
  const today = currentConfig ? todayStr(currentConfig.timezone) : todayStr('UTC');
  await refreshAttendanceEmbed(message, currentConfig, guildId, today);
}

// If the bot was offline at the exact scheduled minute (redeploy, restart,
// brief outage, etc.), node-cron's tick is simply missed and nothing posts
// until the *next* day. This catches that up on boot: for each guild, if
// today's post hasn't gone out yet and the scheduled time has already
// passed for today, post immediately — so the daily message + streak reset
// still happens automatically without anyone needing to run
// /post-attendance-now by hand.
async function catchUpMissedPosts(configs) {
  for (const config of configs) {
    try {
      const dateStr = todayStr(config.timezone);
      const active = db.getActiveMessage(config.guild_id);
      if (active && active.attendance_date === dateStr) continue; // already posted today

      // Don't catch up on the same guild-local day the schedule was just
      // created/edited — the schedule's very first occurrence hasn't
      // happened yet from the user's perspective, even though the clock
      // time technically "already passed" earlier today. Real misses on
      // later days still get caught normally.
      if (config.configured_date === dateStr) {
        console.log(`[catchup] Guild ${config.guild_id} config set today — skipping catch-up, waiting for next scheduled run.`);
        continue;
      }

      const nowMinutes = minutesSinceMidnight(config.timezone);
      const scheduledMinutes = config.hour * 60 + config.minute;
      if (nowMinutes >= scheduledMinutes) {
        console.log(`[catchup] Guild ${config.guild_id} missed today's ${config.hour}:${String(config.minute).padStart(2, '0')} post — posting now.`);
        await postAttendance(client, config);
      }
    } catch (err) {
      console.error(`[catchup] Failed for guild ${config.guild_id}:`, err);
    }
  }
}

async function announceManualInactiveRole(member, config) {
  if (!config?.announcement_channel_id || !config.inactive_role_id) return;

  // Discord can emit GuildMemberUpdate before the corresponding audit-log
  // entry is available, so retry briefly before deciding this was automated.
  let roleUpdate;
  for (let attempt = 0; attempt < 3 && !roleUpdate; attempt += 1) {
    const auditLogs = await member.guild.fetchAuditLogs({
      type: AuditLogEvent.MemberRoleUpdate,
      limit: 10,
    }).catch(() => null);
    roleUpdate = auditLogs?.entries.find(entry => {
      if (entry.target?.id !== member.id || entry.executor?.bot) return false;
      if (Date.now() - entry.createdTimestamp > 15000) return false;
      return entry.changes?.some(change =>
        change.key === '$add' && change.new?.some(role => role.id === config.inactive_role_id)
      );
    });
    if (!roleUpdate && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  if (!roleUpdate) return;

  const channel = await client.channels.fetch(config.announcement_channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;

  const notice = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('⚠️ ON HOLD NOTICE')
    .setDescription(`${member} failed to follow the server rules and has been temporarily moved to **ON HOLD**.`)
    .addFields({
      name: 'Status',
      value: 'This is a temporary hold. Please review the rules before returning to regular activities.',
    })
    .setFooter({ text: 'Inactive role assigned manually' })
    .setTimestamp();

  await channel.send({ embeds: [notice] }).catch(err =>
    console.error(`[announcement] Failed to notify manual inactive role for ${member.id}:`, err.message)
  );
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const configs = db.getAllConfigs();
  configs.forEach(scheduleGuild);
  await catchUpMissedPosts(configs);
  scheduledAnnouncementTask = cron.schedule('* * * * *', () => {
    Promise.all([
      processScheduledAnnouncements(),
      processDueMeetmeAssignments(),
    ]).catch(err => console.error('[scheduler] Failed to process scheduled work:', err));
  }, { timezone: 'UTC' });
  pollTask = cron.schedule('* * * * * *', () => {
    processDuePolls().catch(err => console.error('[poll] Failed to process due polls:', err));
  }, { timezone: 'UTC' });
  await processScheduledAnnouncements();
  await processDuePolls();
  await processDueMeetmeAssignments();
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'setup-attendance') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need the Manage Server permission to do this.', ephemeral: true });
      }

      const channel = interaction.options.getChannel('channel', true);
      const announcementChannel = interaction.options.getChannel('announcement-channel');
      const time = interaction.options.getString('time', true);
      const timezone = interaction.options.getString('timezone') || 'UTC';
      const title = interaction.options.getString('title') || 'Daily Attendance';
      const body = interaction.options.getString('message') || 'React with ✅ if you are online today.';
      const roleAutomationEnabled = interaction.options.getBoolean('enable-role-automation') || false;
      const activeRole = interaction.options.getRole('active-role');
      const inactiveRole = interaction.options.getRole('inactive-role');
      const configuredMeetmeRole = db.getConfig(interaction.guildId)?.meetme_role_id;
      const meetmeRole = interaction.options.getRole('meetme-role') || (configuredMeetmeRole ? interaction.guild.roles.cache.get(configuredMeetmeRole) : null);
      const exemptionRoleIds = parseExemptionRoleIds(interaction.options.getString('exemption-roles'));

      if (!channel.isTextBased() || channel.isThread()) {
        return interaction.reply({ content: 'Choose a regular text channel for attendance.', ephemeral: true });
      }
      if (announcementChannel && (!announcementChannel.isTextBased() || announcementChannel.isThread())) {
        return interaction.reply({ content: 'Choose a regular text channel for announcements.', ephemeral: true });
      }

      const botMember = interaction.guild?.members?.me || await interaction.guild?.members.fetchMe().catch(() => null);
      const requiredPermissions = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.ReadMessageHistory,
      ];
      const missingAttendancePermission = botMember && requiredPermissions.some(permission => !channel.permissionsFor(botMember)?.has(permission));
      const missingAnnouncementPermission = botMember && announcementChannel && requiredPermissions.slice(0, 3).some(permission => !announcementChannel.permissionsFor(botMember)?.has(permission));
      if (missingAttendancePermission || missingAnnouncementPermission) {
        return interaction.reply({ content: 'I need View Channel, Send Messages, Embed Links, Add Reactions, and Read Message History in the selected attendance channel.', ephemeral: true });
      }

      if (exemptionRoleIds.some(roleId => !/^\d{17,20}$/.test(roleId))) {
        return interaction.reply({ content: 'Use valid role IDs or role mentions, separated by commas or spaces.', ephemeral: true });
      }

      if (roleAutomationEnabled && !inactiveRole) {
        return interaction.reply({ content: 'When role automation is enabled, set an `inactive-role`.', ephemeral: true });
      }
      if (activeRole && inactiveRole && activeRole.id === inactiveRole.id) {
        return interaction.reply({ content: 'The active and inactive roles must be different.', ephemeral: true });
      }
      if (meetmeRole?.managed || meetmeRole?.id === interaction.guild.id) {
        return interaction.reply({ content: 'Choose a normal, assignable role for `meetme-role`.', ephemeral: true });
      }

      const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
      if (!match) {
        return interaction.reply({ content: 'Time must be in 24h HH:MM format, e.g. `09:00`.', ephemeral: true });
      }
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      if (hour > 23 || minute > 59) {
        return interaction.reply({ content: 'That time is out of range.', ephemeral: true });
      }

      try {
        // Validate timezone
        Intl.DateTimeFormat('en-US', { timeZone: timezone });
      } catch {
        return interaction.reply({ content: `"${timezone}" isn't a valid IANA timezone (e.g. Asia/Manila, America/New_York).`, ephemeral: true });
      }

      const config = {
        channelId: channel.id, announcementChannelId: announcementChannel?.id || null, hour, minute, timezone, title, body,
        configuredDate: todayStr(timezone),
        activeRoleId: activeRole?.id || null,
        inactiveRoleId: inactiveRole?.id || null,
        exemptionRoleId: exemptionRoleIds.join(',') || null,
        meetmeRoleId: meetmeRole?.id || null,
        roleAutomationEnabled: roleAutomationEnabled ? 1 : 0,
      };
      db.setConfig(interaction.guildId, config);
      scheduleGuild({ guild_id: interaction.guildId, channel_id: channel.id, announcement_channel_id: announcementChannel?.id || null, hour, minute, timezone, title, body, active_role_id: activeRole?.id || null, inactive_role_id: inactiveRole?.id || null, exemption_role_id: exemptionRoleIds.join(',') || null, role_automation_enabled: roleAutomationEnabled ? 1 : 0 });

      return interaction.reply({
        content: `✅ Attendance will post daily in ${channel} at **${match[1].padStart(2, '0')}:${match[2]}** (${timezone}) — that time also acts as the daily reset ("midnight") for streaks and shields. Use \`/post-attendance-now\` to test it immediately.`,
        ephemeral: true,
      });
    }

    if (interaction.commandName === 'announcement') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need the Manage Server permission to do this.', ephemeral: true });
      }

      const channel = interaction.options.getChannel('channel', true);
      if (!channel || !channel.isTextBased() || channel.isThread()) {
        return interaction.reply({ content: 'Choose a valid text channel for the announcement.', ephemeral: true });
      }

      const botMember = interaction.guild?.members?.me || await interaction.guild?.members.fetchMe().catch(() => null);
      const canSend = botMember ? channel.permissionsFor(botMember)?.has(PermissionFlagsBits.SendMessages) : true;
      const canEmbed = botMember ? channel.permissionsFor(botMember)?.has(PermissionFlagsBits.EmbedLinks) : true;

      if (!canSend || !canEmbed) {
        return interaction.reply({
          content: 'I need permission to send messages and embed links in that channel before posting the announcement.',
          ephemeral: true,
        });
      }

      const title = normalizeAnnouncementText(interaction.options.getString('title', true), 256) || 'Announcement';
      const subject = normalizeAnnouncementText(interaction.options.getString('subject', true), 1024) || 'Announcement';
      const message = normalizeAnnouncementText(interaction.options.getString('message', true), 2000) || 'No details provided.';
      const extraMessages = Array.from({ length: 10 }, (_, index) => `extra-message-${index + 1}`)
        .map(optionName => normalizeAnnouncementText(interaction.options.getString(optionName), 2000))
        .filter(Boolean)
        .map(extraMessage => extraMessage
          .split(/\n+/)
          .map(part => part.trim())
          .filter(Boolean)
          .join('\n\n'));
      const formattedMessage = message
        .split(/\n+/)
        .map(part => part.trim())
        .filter(Boolean)
        .join('\n\n');
      const detailsValue = [formattedMessage, ...extraMessages].filter(Boolean).join('\n\n');
      const requiredNotice = '⚠️ Reacting to this announcement is mandatory. Officers will know who has already read it.';

      const embed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle(`⚠️ ${title}`)
        .setDescription(`**${subject}**`)
        .addFields(
          { name: 'Details', value: detailsValue || 'No details provided.' },
          { name: 'Action Required', value: requiredNotice },
        )
        .setFooter({ text: 'Please react with ✅ to confirm you have read this announcement.' });

      const sentMessage = await channel.send({
        content: '@everyone',
        embeds: [embed],
        allowedMentions: { parse: ['everyone'] },
      });
      await sentMessage.react('✅');

      return interaction.reply({
        content: `✅ Announcement posted in ${channel}. Everyone was mentioned and the ✅ reaction has already been added.`,
        ephemeral: true,
      });
    }

    if (interaction.commandName === 'poll') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need the Manage Server permission to do this.', ephemeral: true });
      }

      const channel = interaction.options.getChannel('channel', true);
      const outcomeChannel = interaction.options.getChannel('outcome-channel', true);
      const accessRole = interaction.options.getRole('access-role', true);
      if (!channel?.isTextBased() || channel.isThread() || !outcomeChannel?.isTextBased() || outcomeChannel.isThread()) {
        return interaction.reply({ content: 'Choose regular text channels for the poll and its outcome.', ephemeral: true });
      }
      if (accessRole.managed || accessRole.id === interaction.guild.id) {
        return interaction.reply({ content: 'Choose a normal server role for poll channel access.', ephemeral: true });
      }

      const question = normalizeAnnouncementText(interaction.options.getString('question', true), 256);
      const options = interaction.options.getString('options', true)
        .split('|')
        .map(option => normalizeAnnouncementText(option, 200))
        .filter(Boolean);
      const durationText = interaction.options.getString('duration', true).trim().toLowerCase();
      const durationMs = parsePollDuration(durationText);
      if (!durationMs) {
        return interaction.reply({ content: 'Use a duration like `30s`, `5m`, `1h`, or `1d` (maximum `7d`).', ephemeral: true });
      }
      if (options.length !== POLL_EMOJIS.length) {
        return interaction.reply({ content: 'Provide exactly 2 options separated by the pipe character (|). The first uses 🟢 and the second uses 🔴.', ephemeral: true });
      }
      if (new Set(options.map(option => option.toLowerCase())).size !== options.length) {
        return interaction.reply({ content: 'Poll options must be unique.', ephemeral: true });
      }

      const botMember = interaction.guild?.members?.me || await interaction.guild?.members.fetchMe().catch(() => null);
      const missingPermissions = [channel, outcomeChannel].some(target => {
        if (!botMember) return false;
        const permissions = target.permissionsFor(botMember);
        return !permissions?.has(PermissionFlagsBits.SendMessages) || !permissions.has(PermissionFlagsBits.EmbedLinks);
      });
      if (missingPermissions) {
        return interaction.reply({ content: 'I need Send Messages and Embed Links permission in both channels.', ephemeral: true });
      }
      if (!botMember) {
        return interaction.reply({ content: 'I could not verify my permissions in the poll channel. Please try again.', ephemeral: true });
      }
      if (!channel.permissionsFor(botMember)?.has(PermissionFlagsBits.MentionEveryone)) {
        return interaction.reply({ content: 'I need Mention @everyone permission in the poll channel to notify everyone when the poll opens.', ephemeral: true });
      }
      if (!channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({ content: 'I need Manage Permissions (Manage Roles) in the poll channel to control poll visibility.', ephemeral: true });
      }
      try {
        await channel.permissionOverwrites.edit(accessRole.id, { ViewChannel: true });
      } catch (err) {
        console.error('[poll] Failed to enable poll channel access:', err.message);
        return interaction.reply({ content: 'I could not update poll channel permissions. Check that I have Manage Permissions (Manage Roles) there and that the access role is below my highest role.', ephemeral: true });
      }

      const pollEmbed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`📊 ${question}`)
        .setDescription(options.map((option, index) => `${POLL_EMOJIS[index]} **${option}**`).join('\n'))
        .setFooter({ text: `Poll closes in ${durationText} • React with one option` })
        .setTimestamp();
      const pollMessage = await channel.send({
        content: '@everyone',
        embeds: [pollEmbed],
        allowedMentions: { parse: ['everyone'] },
      });
      for (let index = 0; index < options.length; index += 1) {
        await pollMessage.react(POLL_EMOJIS[index]);
      }

      const pollId = db.createPoll({
        guildId: interaction.guildId,
        channelId: channel.id,
        outcomeChannelId: outcomeChannel.id,
        accessRoleId: accessRole.id,
        messageId: pollMessage.id,
        question,
        options,
        closesAt: Date.now() + durationMs,
      });

      return interaction.reply({
        content: `✅ Poll #${pollId} posted in ${channel}. Results will be announced in ${outcomeChannel} after ${durationText}.`,
        ephemeral: true,
      });
    }

    if (interaction.commandName === 'schedule-announcement') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need the Manage Server permission to do this.', ephemeral: true });
      }

      const channel = interaction.options.getChannel('channel', true);
      if (!channel || !channel.isTextBased() || channel.isThread()) {
        return interaction.reply({ content: 'Choose a valid text channel for the scheduled announcement.', ephemeral: true });
      }

      const date = interaction.options.getString('date', true);
      const time = interaction.options.getString('time', true);
      const timezone = interaction.options.getString('timezone', true).trim();
      const kind = interaction.options.getString('type', true);
      const recurrence = interaction.options.getString('recurrence', true);
      const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
      const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);

      if (!dateMatch || !timeMatch) {
        return interaction.reply({ content: 'Use date `YYYY-MM-DD` and time `HH:MM` (24-hour format).', ephemeral: true });
      }

      const dateObject = new Date(`${date}T00:00:00Z`);
      const isValidDate = !Number.isNaN(dateObject.getTime()) && dateObject.toISOString().slice(0, 10) === date;
      const hour = Number(timeMatch[1]);
      const minute = Number(timeMatch[2]);
      if (!isValidDate || hour > 23 || minute > 59) {
        return interaction.reply({ content: 'Enter a valid calendar date and time.', ephemeral: true });
      }

      try {
        getLocalDateTime(timezone);
      } catch {
        return interaction.reply({ content: 'Use a valid IANA timezone, for example `Asia/Manila` or `UTC`.', ephemeral: true });
      }

      const localNow = getLocalDateTime(timezone);
      if (recurrence === 'once' && date < localNow.date) {
        return interaction.reply({ content: 'A one-time announcement must use today or a future date.', ephemeral: true });
      }

      const botMember = interaction.guild?.members?.me || await interaction.guild?.members.fetchMe().catch(() => null);
      const canSend = botMember ? channel.permissionsFor(botMember)?.has(PermissionFlagsBits.SendMessages) : true;
      const canEmbed = botMember ? channel.permissionsFor(botMember)?.has(PermissionFlagsBits.EmbedLinks) : true;
      if (!canSend || !canEmbed) {
        return interaction.reply({
          content: 'I need permission to send messages and embed links in that channel.',
          ephemeral: true,
        });
      }

      const user = interaction.options.getUser('user');
      let member = null;
      if (kind === 'birthday') {
        if (!user) {
          return interaction.reply({ content: 'Choose a member when scheduling a birthday celebration.', ephemeral: true });
        }
        member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) {
          return interaction.reply({ content: 'That birthday member is not in this server.', ephemeral: true });
        }
      }

      const title = normalizeAnnouncementText(interaction.options.getString('title'), 256) || 'Announcement';
      const subject = normalizeAnnouncementText(interaction.options.getString('subject'), 1024);
      const message = normalizeAnnouncementText(interaction.options.getString('message'), 2000);
      if (kind === 'general' && (!subject || !message)) {
        return interaction.reply({ content: 'General announcements require `title`, `subject`, and `message`.', ephemeral: true });
      }

      const scheduleId = db.createScheduledAnnouncement({
        guildId: interaction.guildId,
        channelId: channel.id,
        scheduledDate: date,
        hour,
        minute,
        timezone,
        kind,
        recurrence,
        title,
        subject,
        message,
        userId: member?.id,
      });

      const repeatText = {
        daily: ' every day',
        weekly: ' every week',
        yearly: ' every year',
      }[recurrence] || '';
      const targetText = kind === 'birthday' ? ` for ${member}` : '';
      return interaction.reply({
        content: `✅ Scheduled ${kind === 'birthday' ? 'a birthday celebration' : 'an announcement'}${targetText} for **${date} at ${time} (${timezone})**${repeatText} in ${channel}. Schedule ID: **${scheduleId}**.`,
        ephemeral: true,
      });
    }

    if (interaction.commandName === 'post-attendance-now') {
      const config = db.getConfig(interaction.guildId);
      if (!config) {
        return interaction.reply({ content: 'Run `/setup-attendance` first.', ephemeral: true });
      }
      await interaction.reply({ content: 'Posting now...', ephemeral: true });
      await postAttendance(client, config);
      return;
    }

    if (interaction.commandName === 'streaks') {
      const embed = await buildLeaderboardEmbed(interaction.guild);
      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'my-streak') {
      const row = db.getStreak(interaction.guildId, interaction.user.id);
      if (!row || row.current_streak === 0) {
        return interaction.reply({ content: "You don't have an active streak yet — react ✅ on today's attendance post!", ephemeral: true });
      }
      const config = db.getConfig(interaction.guildId);
      const currentMonth = monthStr(todayStr(config?.timezone || 'UTC'));
      const shieldsLeft = db.shieldsRemaining(row, currentMonth);

      if (row.shielded_date) {
        return interaction.reply({
          content: `🛡️ Your streak is currently **paused, not broken** — a shield auto-covered your last absence. You're still on a **${row.current_streak}-day** streak (best: ${row.longest_streak}). React ✅ next time to keep it going. Shields left this month: **${shieldsLeft}/${db.MAX_SHIELDS}**.`,
          ephemeral: true,
        });
      }
      return interaction.reply({
        content: `🔥 You're on a **${row.current_streak}-day** streak (best: ${row.longest_streak}). Shields left this month: **${shieldsLeft}/${db.MAX_SHIELDS}** (auto-used if you miss a single day).`,
        ephemeral: true,
      });
    }

    if (interaction.commandName === 'restore-streak') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need the Manage Server permission to do this.', ephemeral: true });
      }

      const usersInput = interaction.options.getString('users', true);
      const streak = interaction.options.getInteger('streak', true);
      const userIds = [...new Set(
        usersInput
          .split(/[\s,]+/)
          .map(value => value.match(/^<@!?([0-9]+)>$/)?.[1] || (value.match(/^[0-9]+$/) ? value : null))
          .filter(Boolean)
      )];
      if (!userIds.length) {
        return interaction.reply({ content: 'Provide one or more member mentions or user IDs.', ephemeral: true });
      }

      const members = [];
      const missingUserIds = [];
      for (const userId of userIds) {
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (member) members.push(member);
        else missingUserIds.push(userId);
      }
      if (!members.length) {
        return interaction.reply({ content: 'None of those members are in this server.', ephemeral: true });
      }

      const restored = members.map(member => ({
        member,
        result: db.restoreStreak(interaction.guildId, member.id, streak),
      }));
      const config = db.getConfig(interaction.guildId);
      const announcementChannel = config?.announcement_channel_id
        ? await client.channels.fetch(config.announcement_channel_id).catch(() => null)
        : null;

      if (announcementChannel?.isTextBased()) {
        const notice = new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle('🔥 STREAKS RESTORED!')
          .setDescription([
            ...restored.map(({ member }) => `${member}’s streak has been **successfully restored**!`),
            '',
            `Each streak was restored to **${streak}** and shields were refreshed.`,
          ].join('\n'))
          .setTimestamp();

        await announcementChannel.send({ embeds: [notice] }).catch(err =>
          console.error('[announcement] Failed to notify restored members:', err.message)
        );
      }

      await refreshActiveAttendanceEmbed(interaction.guildId, config);

      const restoredNames = restored.map(({ member }) => member.toString()).join(', ');
      const missingMessage = missingUserIds.length
        ? ` Skipped ${missingUserIds.length} member${missingUserIds.length === 1 ? '' : 's'} not found in this server.`
        : '';
      return interaction.reply({
        content: `✅ Restored **${streak}** days for ${restoredNames} and refreshed their shields for this month.${missingMessage}`,
        ephemeral: true,
      });
    }

    if (interaction.commandName === 'birthday') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need the Manage Server permission to do this.', ephemeral: true });
      }

      const config = db.getConfig(interaction.guildId);
      if (!config?.announcement_channel_id) {
        return interaction.reply({ content: 'Set an announcement channel first using `/setup-attendance`.', ephemeral: true });
      }

      const user = interaction.options.getUser('user', true);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        return interaction.reply({ content: 'That member is not in this server.', ephemeral: true });
      }

      const announcementChannel = await client.channels.fetch(config.announcement_channel_id).catch(() => null);
      if (!announcementChannel?.isTextBased()) {
        return interaction.reply({ content: 'The configured announcement channel could not be found.', ephemeral: true });
      }

      const notice = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle('🎉 Birthday Greetings!')
        .setDescription([
          `🎂 ${member} has a **Happy Birthday**!`,
          '',
          'Wishing you a fantastic day filled with joy, laughter, and plenty of cake! 🎉',
        ].join('\n'))
        .setTimestamp();

      await announcementChannel.send({ embeds: [notice] }).catch(err =>
        console.error(`[announcement] Failed to send birthday greeting for ${member.id}:`, err.message)
      );

      return interaction.reply({ content: `✅ Birthday greetings announced for ${member}.`, ephemeral: true });
    }

    if (interaction.commandName === 'meetme') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need the Manage Server permission to do this.', ephemeral: true });
      }

      const config = db.getConfig(interaction.guildId);
      if (!config?.meetme_role_id) {
        return interaction.reply({ content: 'Configure a `meetme-role` first with `/setup-attendance`.', ephemeral: true });
      }
      if (!config.announcement_channel_id) {
        return interaction.reply({ content: 'Configure an `announcement-channel` first with `/setup-attendance`.', ephemeral: true });
      }

      const user = interaction.options.getUser('user', true);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      const meetmeRole = interaction.guild.roles.cache.get(config.meetme_role_id)
        || await interaction.guild.roles.fetch(config.meetme_role_id).catch(() => null);
      const announcementChannel = await client.channels.fetch(config.announcement_channel_id).catch(() => null);
      if (!member) {
        return interaction.reply({ content: 'That member is not in this server.', ephemeral: true });
      }
      if (!meetmeRole || meetmeRole.managed || meetmeRole.id === interaction.guild.id) {
        return interaction.reply({ content: 'The configured MeetMe role could not be found or cannot be assigned.', ephemeral: true });
      }
      if (!announcementChannel?.isTextBased()) {
        return interaction.reply({ content: 'The configured announcement channel could not be found.', ephemeral: true });
      }

      const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
      if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({ content: 'I need the Manage Roles permission to assign the MeetMe role.', ephemeral: true });
      }
      if (meetmeRole.position >= botMember.roles.highest.position) {
        return interaction.reply({ content: `Move my highest role above ${meetmeRole} before using /meetme.`, ephemeral: true });
      }
      const canAnnounce = announcementChannel.permissionsFor(botMember);
      if (!canAnnounce?.has(PermissionFlagsBits.SendMessages) || !canAnnounce.has(PermissionFlagsBits.EmbedLinks)) {
        return interaction.reply({ content: 'I need Send Messages and Embed Links permission in the announcement channel.', ephemeral: true });
      }
      if (member.roles.cache.has(meetmeRole.id)) {
        return interaction.reply({ content: `${member} already has ${meetmeRole}.`, ephemeral: true });
      }

      await member.roles.add(meetmeRole);
      const expiresAt = Date.now() + MEETME_DURATION_MS;
      db.createMeetmeAssignment({
        guildId: interaction.guildId,
        userId: member.id,
        roleId: meetmeRole.id,
        expiresAt,
      });
      const notice = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('📣 Called to the Meeting Room')
        .setDescription(`${member} has been called to the Meeting room and given ${meetmeRole}. Access will end after 20 minutes.`)
        .setFooter({ text: 'MeetMe assignment' })
        .setTimestamp();
      await announcementChannel.send({ embeds: [notice] });

      return interaction.reply({ content: `✅ Assigned ${meetmeRole} to ${member} and announced it in ${announcementChannel}.`, ephemeral: true });
    }

    if (interaction.commandName === 'forgive-inactive') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need the Manage Server permission to do this.', ephemeral: true });
      }

      const config = db.getConfig(interaction.guildId);
      if (!config?.inactive_role_id) {
        return interaction.reply({ content: 'Inactive role automation is not configured.', ephemeral: true });
      }

      const user = interaction.options.getUser('user', true);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        return interaction.reply({ content: 'That member is not in this server.', ephemeral: true });
      }

      const forgiveResult = await forgiveInactiveRole(member, config);
      if (!forgiveResult.ok) {
        const content = forgiveResult.reason === 'exempt'
          ? `That member is exempt from automatic role changes.`
          : 'No saved roles were found, or this member is exempt.';
        return interaction.reply({ content, ephemeral: true });
      }

      const existing = db.getStreak(interaction.guildId, user.id);
      if (existing) {
        const restoredStreak = Math.max(existing.current_streak, existing.longest_streak);
        db.restoreStreak(interaction.guildId, user.id, restoredStreak);
      }

      const announcementChannel = config.announcement_channel_id
        ? await client.channels.fetch(config.announcement_channel_id).catch(() => null)
        : null;

      if (announcementChannel?.isTextBased()) {
        const notice = new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle('⚠️ Second Chance Granted')
          .setDescription([
            `${member} has been given a **second chance**. Please make sure to **follow THE FOOL rules** and maintain proper **activity** this time.`,
            '',
            'This is your chance to prove that you can follow the rules and stay active. **Don’t waste it.**',
          ].join('\n'))
          .setTimestamp();

        await announcementChannel.send({ embeds: [notice] }).catch(err =>
          console.error(`[announcement] Failed to notify forgiven member ${member.id}:`, err.message)
        );
      }

      await refreshActiveAttendanceEmbed(interaction.guildId, config);

      const content = forgiveResult.restoredRoles
        ? `Restored ${member} to their roles from before inactive status.`
        : `Removed ${member}'s inactive role. No saved roles were found for this member.`;

      return interaction.reply({ content, ephemeral: true });
    }

    if (interaction.commandName === 'the-judge') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need the Manage Server permission to do this.', ephemeral: true });
      }

      const config = db.getConfig(interaction.guildId);
      if (!config?.inactive_role_id) {
        return interaction.reply({ content: 'The inactive role is not configured yet. Run `/setup-attendance` and choose an inactive role first.', ephemeral: true });
      }

      const botMember = interaction.guild?.members?.me || await interaction.guild?.members.fetchMe().catch(() => null);
      if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({ content: 'I need the Manage Roles permission in this server to use `/the-judge`.', ephemeral: true });
      }

      const inactiveRole = interaction.guild.roles.cache.get(config.inactive_role_id) || await interaction.guild.roles.fetch(config.inactive_role_id).catch(() => null);
      if (!inactiveRole) {
        return interaction.reply({ content: 'The configured inactive role could not be found in this server. Re-run `/setup-attendance` and choose it again.', ephemeral: true });
      }

      if (inactiveRole.position >= botMember.roles.highest.position) {
        return interaction.reply({ content: `I can’t assign <@&${inactiveRole.id}> because it is at or above my highest role. Move my top role above the inactive role in Server Settings → Roles.`, ephemeral: true });
      }

      const user = interaction.options.getUser('user', true);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        return interaction.reply({ content: 'That member is not in this server.', ephemeral: true });
      }

      if (member.roles.cache.has(config.inactive_role_id)) {
        return interaction.reply({ content: `${member} is already on inactive hold.`, ephemeral: true });
      }

      try {
        if (config.role_automation_enabled === 1) {
          await saveCurrentMemberRoles(member, config);
          await updateAttendanceRoles(member, config, true);
        } else {
          await member.roles.add(config.inactive_role_id);
        }
      } catch (err) {
        console.error(`[roles] Failed to apply inactive role to ${member.user.tag}:`, err.message);
        return interaction.reply({ content: `I couldn’t add the inactive role to ${member}. Check that the role is below my highest role and that I still have Manage Roles permission.`, ephemeral: true });
      }

      const channel = config.announcement_channel_id
        ? await client.channels.fetch(config.announcement_channel_id).catch(() => null)
        : null;

      if (channel?.isTextBased()) {
        const notice = new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle('⚠️ ON HOLD NOTICE')
          .setDescription(`${member} has been temporarily moved to **ON HOLD** and assigned the inactive role.`)
          .addFields({
            name: 'Status',
            value: 'This is a temporary hold. Please review the rules before returning to regular activities.',
          })
          .setFooter({ text: 'Inactive role assigned by THE JUDGE' })
          .setTimestamp();

        await channel.send({ embeds: [notice] }).catch(err =>
          console.error(`[announcement] Failed to notify judged member ${member.id}:`, err.message)
        );
      }

      return interaction.reply({ content: `Applied the inactive role to ${member} and announced the hold.`, ephemeral: true });
    }
  } catch (err) {
    console.error('[interaction] error:', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: `Something went wrong: ${err.message}`.slice(0, 1900), ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: `Something went wrong: ${err.message}`.slice(0, 1900), ephemeral: true }).catch(() => {});
    }
  }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const inactiveRoleId = db.getConfig(newMember.guild.id)?.inactive_role_id;
  if (!inactiveRoleId || oldMember.roles.cache.has(inactiveRoleId) || !newMember.roles.cache.has(inactiveRoleId)) return;

  try {
    await announceManualInactiveRole(newMember, db.getConfig(newMember.guild.id));
  } catch (err) {
    console.error('[roles] Failed to process manual inactive-role announcement:', err);
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    if (reaction.emoji.name !== CHECK_EMOJI) return;

    const guildId = reaction.message.guildId;
    if (!guildId) return;

    const config = db.getConfig(guildId);
    const today = config ? todayStr(config.timezone) : null;
    const active = db.getActiveMessage(guildId);
    if (!config || !active) return;
    if (active.message_id !== reaction.message.id || active.attendance_date !== today) return; // old or stale post

    const yesterday = yesterdayStr(config.timezone);

    const isNewCheckin = db.recordCheckin(guildId, user.id, today);

    if (isNewCheckin) {
      const result = db.recordAttendance(guildId, user.id, today, yesterday);
      const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
      if (member) {
        await saveCurrentMemberRoles(member, config);
        if (result.status === 'updated' && result.current_streak === 0) {
          await updateAttendanceRoles(member, config, true);
        } else {
          await updateAttendanceRoles(member, config, false);
        }
      }
      if (result.status === 'updated' || result.status === 'new') {
        console.log(`[streak] ${user.tag} in guild ${guildId} -> ${result.current_streak} day streak`);
      }
    }

    await refreshAttendanceEmbed(reaction.message, config, guildId, today);
  } catch (err) {
    console.error('[reactionAdd] error:', err);
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    if (reaction.emoji.name !== CHECK_EMOJI) return;

    const guildId = reaction.message.guildId;
    if (!guildId) return;

    const config = db.getConfig(guildId);
    const today = config ? todayStr(config.timezone) : null;
    const active = db.getActiveMessage(guildId);
    if (!config || !active) return;
    if (active.message_id !== reaction.message.id || active.attendance_date !== today) return;

    db.removeCheckin(guildId, user.id, today);

    // Note: this only removes them from today's visible list. It does NOT
    // roll back a streak increment that already happened when they first
    // reacted — if they un-react and never react again today, they'll still
    // count as "checked in" for streak purposes but will show as absent
    // tomorrow's list. This edge case is intentionally left simple.
    await refreshAttendanceEmbed(reaction.message, config, guildId, today);
  } catch (err) {
    console.error('[reactionRemove] error:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);
