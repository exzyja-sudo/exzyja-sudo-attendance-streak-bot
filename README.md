# Attendance Streak Bot

For complete Discord invite, installation, channel, role, and command setup
instructions, see [SETUP.md](SETUP.md).

Posts a daily "who's online today" message with a ✅ reaction, and tracks each
user's consecutive-day streak. `/streaks` shows a leaderboard (name + 🔥
streak), like the Accepted list in your screenshot, instead of editing
nicknames.

## How it works

- You configure a channel + time (+ timezone) once with `/setup-attendance`.
  That time is also the daily "midnight" boundary for streaks and shields.
- Every day at that time, the bot posts a fresh embed and reacts ✅ to it.
  The post itself shows a **live, growing list of names** as people react —
  each name shows their current 🔥 streak and 🛡️ shields left **right on
  the post**, so nobody needs to run `/streaks` or `/my-streak` just to see
  who's checked in or how they're doing.
- When someone reacts ✅ **on that day's message**, the bot checks their last
  attendance date:
  - Yesterday (or a shield-covered yesterday, see below) → streak +1
  - Today already recorded → no change (can't double-count)
  - Anything older / never → streak resets to 1
- `/streaks` posts a leaderboard sorted by current streak.
- `/my-streak` privately tells a user their own streak and shields left.
- When a member's streak reaches zero, the bot can remove the saved active
  access roles and add an inactive role. It saves the member's latest active
  roles when they check in, so the bot can restore them later. A configured
  exemption role prevents all automatic role changes for its members.
- Moderators can use `/forgive-inactive user` to remove the inactive role and
  restore the saved roles from before the inactive transition.
- Role automation is optional. Set `enable-role-automation` to `true` in
  `/setup-attendance` and choose an inactive role to activate it. Leave it
  false to run attendance and streak tracking without any role changes.

Old reactions on yesterday's (or older) messages are ignored — only the
currently active post counts, so people can't farm streaks by reacting on old
messages.

### Shields (3 per user, per calendar month)

Right before posting each new day's message, the bot finalizes the previous
day for everyone with an active streak who never reacted:

- **Missed exactly one day** and still have a shield left this month →
  the shield auto-applies. Their streak is **not** reset — it's just paused
  (shown with a 🛡️ in `/streaks`) — and picks back up normally the next time
  they react.
- **Missed two days in a row** → the shield does *not* cover the second
  missed day, even if shields remain. The streak resets to 0.
- **No shields left this month** → any missed day resets the streak to 0.

Shields refill to 3 at the start of each calendar month. `/my-streak` shows
how many a user has left.

### Fire streak tiers & colors

The 🔥 next to each name is colored by streak length, using Discord's
` ```ansi ` code-block trick:

| Streak | Color |
|---|---|
| 1–29 | Classic (yellow/orange) |
| 30–59 | Blue |
| 60–99 | Violet |
| 100–199 | Purple-Red |
| 200+ | Black-Purple |

**Two things to know:**

1. **Colored text only renders on Discord desktop and web.** The mobile
   apps show the raw text without color — this is a Discord client
   limitation, not something a bot can fix.
2. **True animated fire** isn't something Discord lets a bot inline as
   arbitrary text — only a real *custom emoji* uploaded to a server the bot
   is in can be animated. By default the bot uses a static 🔥. If you want
   an actual animated fire per tier, upload animated emoji to your server
   (or a server the bot shares) and set these optional env vars to their
   emoji code (e.g. `<a:fire_blue:123456789012345678>` — copy it in Discord
   by typing `\:emoji_name:` and sending it, or via Server Settings → Emoji):

   ```
   FIRE_EMOJI_DEFAULT=
   FIRE_EMOJI_BLUE=
   FIRE_EMOJI_VIOLET=
   FIRE_EMOJI_PURPLE_RED=
   FIRE_EMOJI_BLACK_PURPLE=
   ```

   Any tier left unset just falls back to 🔥.

### Reliable daily posting (no manual trigger needed)

Once `/setup-attendance` has been run, the bot schedules a daily cron job
per server and posts automatically at that time going forward — you never
need to type `/post-attendance-now` again. On top of that, every time the
bot starts up (first boot, or after a Render redeploy/restart) it checks:
if today's scheduled time has already passed and today's post hasn't gone
out yet, it posts immediately as a catch-up. This covers the edge case
where the bot happened to be restarting at the exact scheduled minute and
would otherwise have silently skipped that day.

## Setup

### 1. Create the Discord application/bot

1. Go to https://discord.com/developers/applications → **New Application**.
2. **Bot** tab → **Add Bot** → copy the **Token** (this is `DISCORD_TOKEN`).
3. Under **Privileged Gateway Intents**, enable **Server Members Intent**
   (needed to show display names on the leaderboard).
4. **OAuth2 → General**, copy the **Application ID** (this is `CLIENT_ID`).
5. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`;
  bot permissions: `Send Messages`, `Embed Links`, `Add Reactions`, `View Audit Log`,
  `Read Message History`, `Manage Roles`, `Mention Everyone` (only if you want the
   `@everyone` ping — remove it from `attendance.js` if not).
6. Open the generated URL to invite the bot to your server.

If you use automatic roles, move the bot's highest role above both the active
and inactive roles in **Server Settings → Roles**. Discord will not let a bot
manage roles at or above its own highest role.

### 2. Install & configure on your VPS

```bash
git clone <this-folder-or-your-repo>
cd attendance-bot
npm install
cp .env.example .env
# edit .env and fill in DISCORD_TOKEN and CLIENT_ID
```

### 3. Register the slash commands (one-time, or after changing them)

```bash
npm run deploy-commands
```

### 4. Run the bot

```bash
npm start
```

For production, keep it alive with a process manager, e.g.:

```bash
npm install -g pm2
pm2 start index.js --name attendance-bot
pm2 save
```

## Deploying on Render (instead of your own VPS)

Render runs the bot as a persistent process, which is what this bot needs
(it holds a live connection to Discord, not just occasional HTTP requests).
The code already includes a tiny built-in HTTP server so Render's health
checks pass, and reads `DB_PATH`/`PORT` from the environment automatically.

### Automatic version updates

Every push to `main` runs the GitHub Actions workflow in
`.github/workflows/bump-version.yml`, which increments the patch version in
`package.json` and pushes the version commit back to GitHub. Render then
deploys that commit. The running version appears in the footer of each daily
Discord check-in embed beside Discord's check-in timestamp, and on the website
footer.

1. Push this project to a GitHub repo (`git init && git add . && git commit -m "init"`,
   create a repo on GitHub, `git remote add origin <url> && git push -u origin main`).
2. On https://dashboard.render.com: **New + → Web Service** → connect the repo.
   Render auto-detects it as a Node app via `package.json`.
3. In the service settings, add `DISCORD_TOKEN` and `CLIENT_ID`.
4. Add a persistent disk at `/var/data` and set `DB_PATH=/var/data/attendance.sqlite`
   so streak data survives deploys and restarts.
5. Register slash commands **once**, from your own machine (not on Render):
   set the same `DISCORD_TOKEN`/`CLIENT_ID` in a local `.env` and run
   `npm run deploy-commands`.
6. Check **Logs** for `Logged in as YourBot#1234`.
7. In Discord, run `/setup-attendance`, then `/post-attendance-now` to test.

Note on Replit: Replit's free tier sleeps when idle, which breaks both the
daily cron post and the always-on reaction listener. If you want to use
Replit anyway, you'd need an "Always On" paid plan (or Replit's Reserved VM),
otherwise the bot effectively goes offline between visits.

## Commands

| Command | Who | Description |
|---|---|---|
| `/setup-attendance channel [announcement-channel] time [timezone] [title] [message] [enable-role-automation] [active-role] [inactive-role] [meetme-role] [exemption-roles]` | Manage Server perm | Configure the daily post, optional inactive-member announcements, role automation, and the role used by `/meetme`. |
| `/schedule-announcement channel date time timezone type recurrence [user] [title] [subject] [message]` | Manage Server perm | Schedule a one-time or yearly general announcement or birthday celebration. |
| `/announcement channel title subject message` | Manage Server perm | Post an announcement immediately. |
| `/meetme user` | Manage Server perm | Call a member to the Meeting room, assign the configured role for 20 minutes, and announce assignment and expiry. |
| `/poll channel outcome-channel access-role question options duration` | Manage Server perm | Open the poll channel to the access role, use 🟢 then 🔴, and announce the result before hiding the channel again. |
| `/close-poll poll-id` | Manage Server perm | Close an active poll immediately, announce its current result, and hide the poll channel from its access role. |
| `/forgive-inactive user` | Manage Server perm | Remove the inactive role and restore the member's roles from before the inactive transition. |
| `/post-attendance-now` | Anyone with access | Posts today's attendance message immediately (good for testing). |
| `/restore-streak users streak` | Manage Server perm | Restores the same streak value and monthly shields for one or more members. Separate mentions or IDs with spaces or commas. |
| `/streaks` | Anyone | Leaderboard embed of everyone's current streak. |
| `/my-streak` | Anyone | Private reply with your own current/best streak. |

To schedule a general announcement, use `type: General announcement`, choose `Once`,
`Every day`, `Every week`, or `Every year`, and provide the title, subject, and message.
For a birthday celebration,
use `type: Birthday celebration`, choose the member in `user`, and select the celebration
date. Birthday schedules can repeat every year. The channel and timezone are chosen for
each schedule, and scheduled announcements are stored in SQLite so they survive restarts.

To create a poll, use `/poll` with exactly two options such as `No | Yes` and a duration
such as `30s`, `5m`, `1h`, or `1d` (maximum `7d`). The bot adds 🟢 to the first option and 🔴 to the second, opens the poll channel to the selected access role, closes the poll when the duration ends, counts
non-bot votes, and posts the winner or tie in the outcome channel.
The command replies with the poll ID. Use `/close-poll poll-id` to end it early;
the bot announces the votes collected so far and closes access immediately.

## Notes

- Data is stored locally in `attendance.sqlite` (created automatically) —
  back that file up if you care about streak history.
- Only the ✅ emoji counts toward streaks; you can still let people react
  ❌/❓ for informational purposes by adding more `message.react(...)` calls
  in `attendance.js`, they just won't affect the streak.
- Multiple servers are supported — each guild has its own config and its own
  streak table.
- To change the daily time later, just run `/setup-attendance` again.
- To disable role automation, run `/setup-attendance` with
  `enable-role-automation` set to false. Re-run it after changing any role
  settings.
