const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MANAGE_GUILD_COMMANDS } = require('../access-commands');

const dbModulePath = require.resolve('../db.js');

test('command access grants are scoped to a guild, member, and command', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-access-'));
  const previousDbPath = process.env.DB_PATH;
  process.env.DB_PATH = path.join(tempRoot, 'access.sqlite');
  delete require.cache[dbModulePath];

  let db;
  try {
    db = require('../db.js');

    assert.equal(db.grantCommandAccess('guild-a', 'user-a', 'accept'), true);
    assert.equal(db.hasCommandAccess('guild-a', 'user-a', 'accept'), true);
    assert.equal(db.grantCommandAccess('guild-a', 'user-a', 'accept'), false);
    assert.equal(db.hasCommandAccess('guild-b', 'user-a', 'accept'), false);
    assert.equal(db.hasCommandAccess('guild-a', 'user-b', 'accept'), false);
    assert.equal(db.hasCommandAccess('guild-a', 'user-a', 'poll'), false);
    assert.equal(db.revokeCommandAccess('guild-a', 'user-a', 'accept'), true);
    assert.equal(db.hasCommandAccess('guild-a', 'user-a', 'accept'), false);
    assert.equal(db.revokeCommandAccess('guild-a', 'user-a', 'accept'), false);

    assert.equal(new Set(MANAGE_GUILD_COMMANDS).size, MANAGE_GUILD_COMMANDS.length);
    assert.ok(MANAGE_GUILD_COMMANDS.length <= 25);
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
