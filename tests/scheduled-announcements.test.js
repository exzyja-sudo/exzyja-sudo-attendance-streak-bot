const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('scheduled announcements can be listed and deleted only within their guild', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-schedules-'));
  const previousDbPath = process.env.DB_PATH;
  const dbModulePath = require.resolve('../db.js');
  process.env.DB_PATH = path.join(tempRoot, 'schedules.sqlite');
  delete require.cache[dbModulePath];

  let db;
  try {
    db = require('../db.js');
    const scheduleData = {
      channelId: 'channel-a',
      scheduledDate: '2030-05-10',
      hour: 9,
      minute: 30,
      timezone: 'UTC',
      kind: 'general',
      recurrence: 'once',
      title: 'Title',
      subject: 'Subject',
      message: 'Details',
    };
    const guildAScheduleId = db.createScheduledAnnouncement({ guildId: 'guild-a', ...scheduleData });
    const guildBScheduleId = db.createScheduledAnnouncement({ guildId: 'guild-b', ...scheduleData });

    assert.deepEqual(db.getScheduledAnnouncements('guild-a').map(schedule => schedule.id), [guildAScheduleId]);
    assert.equal(db.deleteScheduledAnnouncement('guild-b', guildAScheduleId), false);
    assert.equal(db.deleteScheduledAnnouncement('guild-a', guildAScheduleId), true);
    assert.deepEqual(db.getScheduledAnnouncements('guild-a'), []);
    assert.deepEqual(db.getScheduledAnnouncements('guild-b').map(schedule => schedule.id), [guildBScheduleId]);
    assert.equal(db.deleteScheduledAnnouncement('guild-a', guildAScheduleId), false);
  } finally {
    db?.close();
    delete require.cache[dbModulePath];
    if (previousDbPath === undefined) {
      delete process.env.DB_PATH;
    } else {
      process.env.DB_PATH = previousDbPath;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});