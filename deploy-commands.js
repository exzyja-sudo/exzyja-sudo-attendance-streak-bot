require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

function addUserOptions(command, firstDescription, additionalDescription) {
  for (let index = 1; index <= 10; index += 1) {
    command.addUserOption(opt =>
      opt.setName(index === 1 ? 'user' : `user-${index}`)
        .setDescription(index === 1 ? firstDescription : additionalDescription)
        .setRequired(index === 1));
  }
  return command;
}

const commands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show the bot commands and feature guide')
    .toJSON(),

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
    .setName('accept')
    .setDescription('Replace members’ roles with the selected role and welcome them')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(opt =>
      opt.setName('user').setDescription('First member to accept').setRequired(true))
    .addRoleOption(opt =>
      opt.setName('role').setDescription('Role to assign to the member').setRequired(true))
    .addUserOption(opt =>
      opt.setName('user-2').setDescription('Additional member to accept').setRequired(false))
    .addUserOption(opt =>
      opt.setName('user-3').setDescription('Additional member to accept').setRequired(false))
    .addUserOption(opt =>
      opt.setName('user-4').setDescription('Additional member to accept').setRequired(false))
    .addUserOption(opt =>
      opt.setName('user-5').setDescription('Additional member to accept').setRequired(false))
    .addUserOption(opt =>
      opt.setName('user-6').setDescription('Additional member to accept').setRequired(false))
    .addUserOption(opt =>
      opt.setName('user-7').setDescription('Additional member to accept').setRequired(false))
    .addUserOption(opt =>
      opt.setName('user-8').setDescription('Additional member to accept').setRequired(false))
    .addUserOption(opt =>
      opt.setName('user-9').setDescription('Additional member to accept').setRequired(false))
    .addUserOption(opt =>
      opt.setName('user-10').setDescription('Additional member to accept').setRequired(false))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('accept-config')
    .setDescription('Choose where /accept welcome announcements are posted')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(opt =>
      opt.setName('announcement-channel').setDescription('Channel for acceptance welcome messages').setRequired(true))
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
    .setName('scheduled-announcements')
    .setDescription('List this server’s scheduled announcements and their IDs')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('delete-scheduled-announcement')
    .setDescription('Delete one of this server’s scheduled announcements')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(opt =>
      opt.setName('id').setDescription('ID shown by /scheduled-announcements').setRequired(true).setMinValue(1))
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
    .setDescription('Refresh the configured server chat level leaderboard')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('level-leaderboard-config')
    .setDescription('Choose where the server level leaderboard is posted')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(opt =>
      opt.setName('channel').setDescription('Channel for the level leaderboard').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('level-up')
    .setDescription('Grant levels to a member')
    .addUserOption(opt =>
      opt.setName('user').setDescription('Member who will receive levels').setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('levels').setDescription('Number of levels to grant').setRequired(true).setMinValue(1).setMaxValue(100))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('level-demote')
    .setDescription('Remove levels from a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(opt =>
      opt.setName('user').setDescription('Member who will lose levels').setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('levels').setDescription('Number of levels to remove').setRequired(true).setMinValue(1).setMaxValue(100))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('level-config')
    .setDescription('Choose where level-up announcements are posted')
    .addChannelOption(opt =>
      opt.setName('announcement-channel').setDescription('Channel for level-up announcements').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('level-nickname')
    .setDescription('Enable or disable the automatic level suffix in member nicknames')
    .addBooleanOption(opt =>
      opt.setName('enabled').setDescription('Whether level suffixes should be added to nicknames').setRequired(true))
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

  addUserOptions(
    new SlashCommandBuilder()
      .setName('meetme')
      .setDescription('Assign the configured MeetMe role to up to 10 members'),
    'Member to receive the MeetMe role',
    'Additional member to receive the MeetMe role',
  ).toJSON(),

  addUserOptions(
    new SlashCommandBuilder()
      .setName('close-meetme')
      .setDescription('End active MeetMe assignments for up to 10 members'),
    'Member whose MeetMe access should end',
    'Additional member whose MeetMe access should end',
  ).toJSON(),

  addUserOptions(
    new SlashCommandBuilder()
      .setName('forgive-inactive')
      .setDescription('Restore roles for up to 10 members after forgiving their inactive status'),
    'Member whose previous roles should be restored',
    'Additional member whose previous roles should be restored',
  ).toJSON(),

  addUserOptions(
    new SlashCommandBuilder()
      .setName('the-judge')
      .setDescription('Apply the inactive role to up to 10 members and announce the holds'),
    'Member to place on hold',
    'Additional member to place on hold',
  ).toJSON(),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Timeout a member and announce the reason')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(opt =>
      opt.setName('user').setDescription('Member to mute').setRequired(true))
    .addStringOption(opt =>
      opt.setName('duration').setDescription('Duration such as 1s, 1m, 1h, or 1d (maximum 28d)').setRequired(true).setMaxLength(16))
    .addStringOption(opt =>
      opt.setName('reason').setDescription('Reason for the mute').setRequired(true).setMaxLength(400))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove a member\'s timeout and announce it')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(opt =>
      opt.setName('user').setDescription('Member whose timeout should be removed').setRequired(true))
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
