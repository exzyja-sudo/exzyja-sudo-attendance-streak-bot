const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

test('message XP observes cooldowns, advances levels, and ranks users per guild', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-levels-'));
  const previousDbPath = process.env.DB_PATH;
  const testDbPath = path.join(tempRoot, 'levels.sqlite');
  process.env.DB_PATH = testDbPath;
  const dbModulePath = require.resolve('../db.js');
  let db;
  delete require.cache[dbModulePath];

  try {
    const legacyDb = new Database(testDbPath);
    legacyDb.exec(`
      CREATE TABLE user_levels (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        total_xp INTEGER NOT NULL DEFAULT 0,
        last_xp_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );
    `);
    legacyDb.prepare('INSERT INTO user_levels (guild_id, user_id, total_xp, last_xp_at) VALUES (?, ?, ?, ?)')
      .run('legacy-guild', 'legacy-user', 250, 1000);
    legacyDb.close();

    db = require('../db.js');
    assert.equal(db.getLevel('legacy-guild', 'legacy-user').level, 3);
    assert.equal(db.getLevel('legacy-guild', 'legacy-user').xp_into_level, 60);

    const firstAward = db.awardMessageXp('guild-a', 'user-a', 95, db.XP_COOLDOWN_MS, 100000);
    assert.equal(firstAward.total_xp, 95);
    assert.equal(firstAward.level, 1);

    const cooledDown = db.awardMessageXp('guild-a', 'user-a', 20, db.XP_COOLDOWN_MS, 399999);
    assert.equal(cooledDown.awarded, false);
    assert.equal(cooledDown.total_xp, 95);

    const levelUp = db.awardMessageXp('guild-a', 'user-a', 15, db.XP_COOLDOWN_MS, 400000);
    assert.equal(levelUp.total_xp, 110);
    assert.equal(levelUp.previous_level, 1);
    assert.equal(levelUp.level, 2);
    assert.equal(levelUp.xp_into_level, 10);
    assert.equal(levelUp.xp_to_next_level, 100);

    const secondLevelAward = db.awardMessageXp('guild-a', 'user-c', 100, db.XP_COOLDOWN_MS, 100000);
    assert.equal(secondLevelAward.level, 2);
    assert.equal(secondLevelAward.xp_into_level, 0);
    assert.equal(secondLevelAward.xp_to_next_level, 110);
    const thirdLevelAward = db.awardMessageXp('guild-a', 'user-c', 110, db.XP_COOLDOWN_MS, 400000);
    assert.equal(thirdLevelAward.level, 3);
    assert.equal(thirdLevelAward.xp_into_level, 0);
    assert.equal(thirdLevelAward.xp_to_next_level, 120);

    db.awardMessageXp('guild-a', 'user-d', 98, db.XP_COOLDOWN_MS, 100000);
    const reactionAward = db.awardReactionXp('guild-a', 'user-d');
    assert.equal(reactionAward.total_xp, 101);
    assert.equal(reactionAward.previous_level, 1);
    assert.equal(reactionAward.level, 2);
    const repeatedReaction = db.awardReactionXp('guild-a', 'user-d');
    assert.equal(repeatedReaction.awarded, true);
    assert.equal(repeatedReaction.total_xp, 104);
    assert.equal(repeatedReaction.last_xp_at, 100000);
    const messageDuringCooldown = db.awardMessageXp('guild-a', 'user-d', 15, db.XP_COOLDOWN_MS, 100001);
    assert.equal(messageDuringCooldown.awarded, false);
    assert.equal(messageDuringCooldown.total_xp, 104);

    db.awardMessageXp('guild-a', 'user-b', 150, db.XP_COOLDOWN_MS, 100000);
    const manualGrant = db.addLevels('guild-a', 'user-b', 2);
    assert.equal(manualGrant.level, 4);
    assert.equal(manualGrant.xp_into_level, 50);
    assert.equal(manualGrant.xp_added, 230);
    assert.equal(manualGrant.levels_added, 2);
    assert.deepEqual(db.getLevelLeaderboard('guild-a').map(row => row.user_id), ['user-b', 'user-c', 'user-a', 'user-d']);
    assert.deepEqual(db.getLevelLeaderboard('guild-b'), []);
    db.setLevelAnnouncementChannel('guild-a', 'channel-123');
    assert.equal(db.getLevelAnnouncementChannel('guild-a'), 'channel-123');
    assert.equal(db.getLevelAnnouncementChannel('guild-b'), null);
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