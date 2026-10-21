const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('sleep role is stored independently from attendance configuration', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-sleep-'));
  const previousDbPath = process.env.DB_PATH;
  process.env.DB_PATH = path.join(tempRoot, 'sleep.sqlite');
  const dbModulePath = require.resolve('../db.js');
  delete require.cache[dbModulePath];

  try {
    const db = require('../db.js');
    db.setSleepRole('guild-a', 'role-a');
    assert.equal(db.getSleepRole('guild-a'), 'role-a');

    db.setConfig('guild-a', {
      channelId: 'attendance-channel',
      hour: 9,
      minute: 0,
      timezone: 'UTC',
      title: 'Attendance',
      body: 'Check in',
      announcementChannelId: null,
      configuredDate: '2026-10-21',
      activeRoleId: null,
      inactiveRoleId: null,
      exemptionRoleId: null,
      meetmeRoleId: null,
      roleAutomationEnabled: 0,
    });
    assert.equal(db.getSleepRole('guild-a'), 'role-a');
    db.close();
  } finally {
    delete require.cache[dbModulePath];
    if (previousDbPath === undefined) {
      delete process.env.DB_PATH;
    } else {
      process.env.DB_PATH = previousDbPath;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
