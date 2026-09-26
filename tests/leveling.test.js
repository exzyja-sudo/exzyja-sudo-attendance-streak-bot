const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('message XP observes cooldowns, advances levels, and ranks users per guild', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-levels-'));
  const previousDbPath = process.env.DB_PATH;
  process.env.DB_PATH = path.join(tempRoot, 'levels.sqlite');
  const dbModulePath = require.resolve('../db.js');
  delete require.cache[dbModulePath];

  try {
    const db = require('../db.js');
    const firstAward = db.awardMessageXp('guild-a', 'user-a', 95, 60000, 100000);
    assert.equal(firstAward.total_xp, 95);
    assert.equal(firstAward.level, 1);

    const cooledDown = db.awardMessageXp('guild-a', 'user-a', 20, 60000, 120000);
    assert.equal(cooledDown.awarded, false);
    assert.equal(cooledDown.total_xp, 95);

    const levelUp = db.awardMessageXp('guild-a', 'user-a', 15, 60000, 160000);
    assert.equal(levelUp.total_xp, 110);
    assert.equal(levelUp.previous_level, 1);
    assert.equal(levelUp.level, 2);
    assert.equal(levelUp.xp_into_level, 10);

    db.awardMessageXp('guild-a', 'user-b', 150, 60000, 100000);
    assert.deepEqual(db.getLevelLeaderboard('guild-a').map(row => row.user_id), ['user-b', 'user-a']);
    assert.deepEqual(db.getLevelLeaderboard('guild-b'), []);
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