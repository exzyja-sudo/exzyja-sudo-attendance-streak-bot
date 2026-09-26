const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('manually closed MeetMe assignment is no longer active or due', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-meetme-'));
  const previousDbPath = process.env.DB_PATH;
  process.env.DB_PATH = path.join(tempRoot, 'meetme.sqlite');
  const dbModulePath = require.resolve('../db.js');
  delete require.cache[dbModulePath];

  try {
    const db = require('../db.js');
    const assignmentId = db.createMeetmeAssignment({
      guildId: 'guild-a',
      userId: 'user-a',
      roleId: 'role-a',
      expiresAt: 1000,
    });

    const active = db.getActiveMeetmeAssignment('guild-a', 'user-a');
    assert.equal(active.id, assignmentId);
    assert.equal(db.getDueMeetmeAssignments(1000).length, 1);

    db.markMeetmeAssignmentRemoved(assignmentId, 900);
    assert.equal(db.getActiveMeetmeAssignment('guild-a', 'user-a'), undefined);
    assert.equal(db.getDueMeetmeAssignments(1000).length, 0);
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