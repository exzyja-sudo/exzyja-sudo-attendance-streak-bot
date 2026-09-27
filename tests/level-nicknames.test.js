const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLevelNickname, syncLevelNickname } = require('../level-nicknames');

test('level nickname appends exact level and stays within Discord length limit', () => {
  assert.equal(buildLevelNickname('Alex', 6), 'Alex ⭐ 6');
  assert.equal(buildLevelNickname('A'.repeat(40), 123), `${'A'.repeat(26)} ⭐ 123`);
  assert.ok(Array.from(buildLevelNickname('名'.repeat(40), 99)).length <= 32);
});

test('nickname sync preserves the base name, follows level changes, and removes old badge roles', async () => {
  const memberRoleIds = new Set(['old-level-role']);
  const nicknameRows = new Map();
  const member = {
    id: 'member-a',
    nickname: 'Alex',
    displayName: 'Alex',
    user: { username: 'alex', bot: false },
    manageable: true,
    guild: {
      id: 'guild-a',
      ownerId: 'owner',
      members: { me: { permissions: { has: () => true } } },
    },
    roles: {
      cache: { has: roleId => memberRoleIds.has(roleId) },
      remove: async roleIds => roleIds.forEach(roleId => memberRoleIds.delete(roleId)),
    },
    setNickname: async nickname => {
      member.nickname = nickname;
      member.displayName = nickname;
    },
  };
  const database = {
    getLevelNickname: (guildId, userId) => nicknameRows.get(`${guildId}:${userId}`) || null,
    setLevelNickname: (guildId, userId, base_name, managed_nickname) => {
      nicknameRows.set(`${guildId}:${userId}`, { base_name, managed_nickname });
    },
    getLevelNicknameEnabled: () => true,
    getLevelBadgeRoles: () => [{ role_id: 'old-level-role' }],
  };

  assert.equal(await syncLevelNickname(member, 6, database), true);
  assert.equal(member.nickname, 'Alex ⭐ 6');
  assert.deepEqual(nicknameRows.get('guild-a:member-a'), {
    base_name: 'Alex',
    managed_nickname: 'Alex ⭐ 6',
  });
  assert.equal(memberRoleIds.has('old-level-role'), false);

  assert.equal(await syncLevelNickname(member, 7, database), true);
  assert.equal(member.nickname, 'Alex ⭐ 7');

  member.nickname = 'Captain ⭐ 7';
  member.displayName = member.nickname;
  assert.equal(await syncLevelNickname(member, 8, database), true);
  assert.equal(member.nickname, 'Captain ⭐ 8');
});

test('nickname sync does nothing unless enabled for the guild', async () => {
  let nicknameChanges = 0;
  const member = {
    id: 'member-a',
    user: { username: 'alex', bot: false },
    guild: { id: 'guild-a' },
    setNickname: async () => { nicknameChanges += 1; },
  };
  const database = { getLevelNicknameEnabled: () => false };

  assert.equal(await syncLevelNickname(member, 6, database), false);
  assert.equal(nicknameChanges, 0);
});