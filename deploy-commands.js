require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('clear-messages')
    .setDescription('Delete recent messages from a selected channel after confirmation')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(opt =>
      opt.setName('channel').setDescription('Channel to clear messages from').setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread))
    .addIntegerOption(opt =>
      opt.setName('amount').setDescription('Number of recent messages to review (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('setup-attendance')
    .setDescription('Configure the daily attendance post for this server')
    .addChannelOption(opt =>
      opt.setName('channel').setDescription('Channel to post attendance in').setRequired(true))
    .addStringOption(opt =>
      opt.setName('time').setDescription('Time to post daily, 24h HH:MM (e.g. 09:00)').setRequired(true))
      .addChannelOption(opt =>
        opt.setName('announcement-channel').setDescription('Channel for inactive-member announcements').setRequired(false))
    .addStringOption(opt =>
      opt.setName('timezone').setDescription('IANA timezone, e.g. Asia/Manila (default UTC)').setRequired(false))
    .addStringOption(opt =>
      opt.setName('title').setDescription('Embed title (default "Daily Attendance")').setRequired(false))
    .addStringOption(opt =>
      opt.setName('message').setDescription('Embed body text').setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('enable-role-automation').setDescription('Enable inactive role changes and saved-role restoration').setRequired(false))
    .addRoleOption(opt =>
      opt.setName('active-role').setDescription('Optional fallback active role to re-add when a member checks in again').setRequired(false))
    .addRoleOption(opt =>
      opt.setName('inactive-role').setDescription('Role to add when the streak reaches zero').setRequired(false))
    .addRoleOption(opt =>
      opt.setName('meetme-role').setDescription('Role assigned by /meetme').setRequired(false))
    .addStringOption(opt =>
      opt.setName('exemption-roles').setDescription('Role IDs or mentions, separated by commas or spaces').setRequired(false))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('announcement')
    .setDescription('Post an announcement that members must react to confirm they read it')
    .addChannelOption(opt =>
      opt.setName('channel').setDescription('Channel to post the announcement in').setRequired(true))
    .addStringOption(opt =>
      opt.setName('title').setDescription('Announcement title').setRequired(true))
    .addStringOption(opt =>
      opt.setName('subject').setDescription('Announcement subject or headline').setRequired(true))
    .addStringOption(opt =>
      opt.setName('message').setDescription('Announcement details').setRequired(true))
    .addStringOption(opt =>
      opt.setName('extra-message-1').setDescription('Optional extra paragraph or bullet list to include in the same announcement box').setRequired(false))
    .addStringOption(opt =>
      opt.setName('extra-message-2').setDescription('Optional second extra paragraph or bullet list').setRequired(false))
    .addStringOption(opt =>
      opt.setName('extra-message-3').setDescription('Optional third extra paragraph or bullet list').setRequired(false))
    .addStringOption(opt =>
      opt.setName('extra-message-4').setDescription('Optional fourth extra paragraph or bullet list').setRequired(false))
    .addStringOption(opt =>
      opt.setName('extra-message-5').setDescription('Optional fifth extra paragraph or bullet list').setRequired(false))
    .addStringOption(opt =>
      opt.setName('extra-message-6').setDescription('Optional sixth extra paragraph or bullet list').setRequired(false))
    .addStringOption(opt =>
      opt.setName('extra-message-7').setDescription('Optional seventh extra paragraph or bullet list').setRequired(false))
    .addStringOption(opt =>
      opt.setName('extra-message-8').setDescription('Optional eighth extra paragraph or bullet list').setRequired(false))
    .addStringOption(opt =>
      opt.setName('extra-message-9').setDescription('Optional ninth extra paragraph or bullet list').setRequired(false))
    .addStringOption(opt =>
      opt.setName('extra-message-10').setDescription('Optional tenth extra paragraph or bullet list').setRequired(false))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('schedule-announcement')
    .setDescription('Schedule a future or yearly announcement')
    .addChannelOption(opt =>
      opt.setName('channel').setDescription('Channel where the announcement will be posted').setRequired(true))
    .addStringOption(opt =>
      opt.setName('date').setDescription('Date in YYYY-MM-DD format').setRequired(true))
    .addStringOption(opt =>
      opt.setName('time').setDescription('Local time in 24-hour HH:MM format').setRequired(true))
    .addStringOption(opt =>
      opt.setName('timezone').setDescription('IANA timezone, e.g. Asia/Manila').setRequired(true))
    .addStringOption(opt =>
      opt.setName('type').setDescription('Announcement type').setRequired(true)
        .addChoices(
          { name: 'General announcement', value: 'general' },
          { name: 'Birthday celebration', value: 'birthday' },
        ))
    .addStringOption(opt =>
      opt.setName('recurrence').setDescription('Choose how often to post the announcement').setRequired(true)
        .addChoices(
          { name: 'Once', value: 'once' },
          { name: 'Every day', value: 'daily' },
          { name: 'Every week', value: 'weekly' },
          { name: 'Every year', value: 'yearly' },
        ))
    .addUserOption(opt =>
      opt.setName('user').setDescription('Member for a birthday celebration').setRequired(false))
    .addStringOption(opt =>
      opt.setName('title').setDescription('General announcement title').setRequired(false))
    .addStringOption(opt =>
      opt.setName('subject').setDescription('General announcement subject').setRequired(false))
    .addStringOption(opt =>
      opt.setName('message').setDescription('General announcement details').setRequired(false))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a reaction poll and announce the outcome later')
    .addChannelOption(opt =>
      opt.setName('channel').setDescription('Channel where the poll will be posted').setRequired(true))
    .addChannelOption(opt =>
      opt.setName('outcome-channel').setDescription('Channel for the final poll result').setRequired(true))
    .addRoleOption(opt =>
      opt.setName('access-role').setDescription('Role allowed to view the poll channel while active').setRequired(true))
    .addStringOption(opt =>
      opt.setName('question').setDescription('Poll question').setRequired(true).setMaxLength(256))
    .addStringOption(opt =>
      opt.setName('options').setDescription('Two options separated with |, for example No | Yes').setRequired(true).setMaxLength(400))
    .addStringOption(opt =>
      opt.setName('duration').setDescription('Duration such as 30s, 5m, 1h, or 1d (maximum 7d)').setRequired(true).setMaxLength(8))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('close-poll')
    .setDescription('Close an active poll now and announce its current result')
    .addIntegerOption(opt =>
      opt.setName('poll-id').setDescription('ID of the active poll to close').setRequired(true).setMinValue(1))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('post-attendance-now')
    .setDescription('Manually post today\'s attendance message right now')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('streaks')
    .setDescription('Show the attendance streak leaderboard')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('my-streak')
    .setDescription('Show your current attendance streak')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('level')
    .setDescription('Show your chat level and XP')
    .addUserOption(opt =>
      opt.setName('user').setDescription('Member whose level to view').setRequired(false))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('level-leaderboard')
    .setDescription('Show the server chat level leaderboard')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('add-levels')
    .setDescription('Manually grant levels to a member')
    .addUserOption(opt =>
      opt.setName('user').setDescription('Member who will receive levels').setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('levels').setDescription('Number of levels to grant').setRequired(true).setMinValue(1).setMaxValue(100))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('level-config')
    .setDescription('Choose where level-up announcements are posted')
    .addChannelOption(opt =>
      opt.setName('announcement-channel').setDescription('Channel for level-up announcements').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('restore-streak')
    .setDescription('Manually restore multiple members\' streaks and shields')
    .addStringOption(opt =>
      opt.setName('users').setDescription('Members to restore, separated by spaces or commas').setRequired(true).setMaxLength(1000))
    .addIntegerOption(opt =>
      opt.setName('streak').setDescription('Streak value to set for every member').setRequired(true).setMinValue(0))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Post a birthday greeting in the announcement channel')
    .addUserOption(opt =>
      opt.setName('user').setDescription('Member to greet for their birthday').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('meetme')
    .setDescription('Assign the configured MeetMe role and announce it')
    .addUserOption(opt =>
      opt.setName('user').setDescription('Member to receive the MeetMe role').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('close-meetme')
    .setDescription('End a member\'s active MeetMe assignment early')
    .addUserOption(opt =>
      opt.setName('user').setDescription('Member whose MeetMe access should end').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('forgive-inactive')
    .setDescription('Restore a member\'s roles after forgiving their inactive status')
    .addUserOption(opt =>
      opt.setName('user').setDescription('Member whose previous roles should be restored').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('the-judge')
    .setDescription('Apply the inactive role to a member and announce the hold')
    .addUserOption(opt =>
      opt.setName('user').setDescription('Member to place on hold').setRequired(true))
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('Slash commands registered globally (can take up to ~1 hour to appear everywhere; instant in servers if you use guild commands instead).');
  } catch (err) {
    console.error(err);
  }
})();
