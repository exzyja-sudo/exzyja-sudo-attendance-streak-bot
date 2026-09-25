# Attendance Streak Bot Setup Guide

This guide explains how to add the bot to Discord, configure attendance, and optionally enable automatic role changes.

## What the bot needs

### Required channel

Create one text channel for attendance, for example:

```text
#attendance
```

This is the only channel the bot needs. The bot posts the daily attendance message there.

There is no separate inactive channel. Inactive members are managed with the inactive Discord role. You can optionally choose an announcement channel for inactive notifications.

### Optional roles

Create these roles if you want automatic role management:

- `Active`: the role for members who are participating.
- `Inactive`: the role added when a member's streak reaches zero.
- `Exempt`: members with this role are completely protected from automatic role changes.

The role names can be anything. Select the actual roles in `/setup-attendance`.

## Add the bot to Discord

Follow these steps to invite the bot into your server:

1. Open the Discord Developer Portal: https://discord.com/developers/applications
2. Click your bot application. If you do not have one, click **New Application**, enter a name, and click **Create**.
3. Open **Bot** in the left menu and click **Add Bot** or **Reset Token** if the bot already exists.
4. Copy the token and put it in your local `.env` file as `DISCORD_TOKEN`. Never share this token.
5. Open **General Information**, copy the **Application ID**, and put it in `.env` as `CLIENT_ID`.
6. Open **OAuth2 -> URL Generator** in the left menu.
7. Under **Scopes**, select:
   - `bot`
   - `applications.commands`
8. Under **Bot Permissions**, select:
   - View Channels
   - Send Messages
   - Embed Links
   - Add Reactions
   - Read Message History
   - View Audit Log, so the bot can distinguish manual role assignments from its own automatic changes
   - Manage Roles, only if role automation will be enabled
   - Mention Everyone, only if you want the daily `@everyone` mention
9. Scroll to the bottom of the page and click **Copy** beside the generated URL.
10. Open that copied URL in your browser.
11. Choose the Discord server where you want to install the bot. You must have **Manage Server** or **Administrator** permission in that server.
12. Click **Continue**, review the permissions, click **Authorize**, and complete the CAPTCHA if Discord asks for it.
13. Open your server and confirm that the bot appears in the member list.

The invite URL has this format, where `YOUR_CLIENT_ID` is the Application ID:

```text
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot%20applications.commands&permissions=268651584
```

Using the URL Generator is recommended because it creates the correct permission value for your selected options.

The bot must be above the `Active` and `Inactive` roles in **Server Settings -> Roles**. Discord does not allow a bot to manage roles at or above its highest role.

## Configure the project

From the project folder:

```bash
npm install
```

Create `.env` from the example file and fill in your values:

```env
DISCORD_TOKEN=your-bot-token
CLIENT_ID=your-application-client-id
DISCORD_CLIENT_ID=your-application-client-id
DISCORD_CLIENT_SECRET=your-oauth2-client-secret
DISCORD_REDIRECT_URI=https://your-render-domain.onrender.com/auth/callback
```

For Render or another persistent volume, also set:

```env
DB_PATH=/var/data/attendance.sqlite
```

Register the slash commands:

```bash
npm run deploy-commands
```

Start the bot:

```bash
npm start
```

## Configure attendance only

If you do not want automatic role changes, run `/setup-attendance` and leave role automation disabled.

Use these values:

```text
channel: #attendance
announcement-channel: #attendance-announcements
time: 09:00
timezone: Asia/Manila
enable-role-automation: false
```

Attendance posts, check-ins, streaks, shields, `/streaks`, and `/my-streak` will work. The bot will not add or remove roles.

## Configure attendance and roles

Run `/setup-attendance` as a moderator with the Manage Server permission.

Example:

```text
channel: #attendance
time: 09:00
timezone: Asia/Manila
enable-role-automation: true
inactive-role: @Inactive
exemption-roles: @Exempt, @Staff
```

The `inactive-role` is the role used when the member is placed on hold. The bot also saves each member's latest active access roles when they check in and restores them later when they are forgiven. The `active-role` option remains optional as a fallback if you want to re-add a shared role as well. The exemption roles are optional; enter one or more role mentions or IDs separated by commas or spaces.
The `announcement-channel` is optional. When set, the bot posts a red boxed ON HOLD announcement when a moderator manually adds the configured inactive role to a member. It also mentions members after the bot assigns the inactive role because they missed attendance. Give the bot View Channel, Send Messages, and Embed Links permission in this channel.

## How automatic roles work

1. A member reacts with the checkmark on the current attendance post.
2. The bot records the member's attendance, updates the streak, and saves their currently active access roles.
3. If the streak reaches zero after absence processing, the bot removes the saved access roles and adds the inactive role.
4. If the member checks in again, the bot removes the inactive role and restores the saved active access roles.
5. Members who have any configured exemption role are never changed by the bot.
6. If an announcement channel is configured, the bot announces members placed on hold after missing attendance.
7. If a moderator manually adds the configured inactive role, the bot posts a red ON HOLD notice in the announcement channel. Automatic role changes made by the bot do not create this manual-action notice.

The bot can only change roles below its highest role and only when it has the Manage Roles permission.

## Forgive an inactive member

A moderator can restore the roles saved before the inactive transition:

```text
/forgive-inactive user:@Member
```

This removes the inactive role and restores the saved roles. It requires Manage Server permission.

If the member is exempt, or there is no saved role snapshot, the command does nothing.

## Commands

| Command | Who can use it | Purpose |
|---|---|---|
| `/setup-attendance` | Manage Server | Set the attendance channel, time, timezone, and optional role automation. |
| `/post-attendance-now` | Anyone with command access | Post an attendance message immediately for testing. |
| `/schedule-announcement` | Manage Server | Schedule a one-time or yearly general announcement or birthday celebration. Choose the channel, date, time, timezone, type, and recurrence. |
| `/announcement` | Manage Server | Post an announcement immediately. |
| `/poll` | Manage Server | Create a reaction poll with 2-10 options and announce the result in a separate outcome channel. |
| `/restore-streak users streak` | Manage Server | Restore the same streak value and monthly shields for one or more members. Enter mentions or IDs separated by spaces or commas. |
| `/streaks` | Anyone | Show the current streak leaderboard. |
| `/my-streak` | Anyone | Show your current streak and shields privately. |
| `/forgive-inactive user` | Manage Server | Restore a member's saved roles and remove the inactive role. |

### Schedule a future announcement

Use `/schedule-announcement` with a date in `YYYY-MM-DD` format and a local time in
`HH:MM` format. Select `Once`, `Every day`, `Every week`, or `Every year`. Daily posts
start on the selected date. Weekly posts use the weekday of the selected date.
General announcements require a title, subject, and message. Birthday celebrations
require the member and automatically use the birthday greeting. The selected channel
and timezone are stored with the schedule, and the bot checks for due schedules every
minute after startup.

### Create a poll

Use `/poll` with a question, a duration in minutes, a poll channel, and an outcome
channel. Enter options separated by `|`, for example `Yes | No | Maybe`. The bot adds
numbered reactions, counts non-bot votes when the duration ends, and announces the
winner, tie, or no-vote result in the outcome channel. Polls are stored in SQLite and
continue after a bot restart.

## Disable role automation

Run `/setup-attendance` again with:

```text
enable-role-automation: false
```

Attendance and streak tracking continue. The bot stops automatic role changes. The selected attendance channel remains active.

## Important notes

- Only reactions on the current attendance message count.
- The bot uses the configured timezone for daily attendance boundaries.
- The bot stores data in `attendance.sqlite` unless `DB_PATH` is configured.
- If the bot restarts, the database preserves streaks, shields, settings, and saved role snapshots.
- After changing slash-command definitions, run `npm run deploy-commands` again.
