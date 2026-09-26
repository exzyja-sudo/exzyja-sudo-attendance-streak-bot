const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createLevelBadgeIcon, syncLevelBadge } = require('../level-badges');

test('level badge icons are valid numbered PNGs', () => {
  const first = createLevelBadgeIcon(1);
  const twelfth = createLevelBadgeIcon(12);
  assert.deepEqual(first.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.notDeepEqual(first, twelfth);

  let offset = 8;
  let imageData;
  while (offset < first.length) {
    const length = first.readUInt32BE(offset);
    const type = first.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR') {
      assert.equal(first.readUInt32BE(offset + 8), 64);
      assert.equal(first.readUInt32BE(offset + 12), 64);
    }
    if (type === 'IDAT') imageData = first.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
  }
  assert.equal(zlib.inflateSync(imageData).length, 64 * (64 * 4 + 1));
  assert.throws(() => createLevelBadgeIcon(0), RangeError);
});

test('level badge sync creates the exact level role and removes the previous one', async () => {
  const roles = new Map();
  const memberRoleIds = new Set();
  const badgeRoleIds = new Map();
  let createdRoles = 0;
  let nextRoleId = 1;
  const roleCache = {
    get: id => roles.get(id),
    get size() { return roles.size; },
  };
  const guild = {
    id: 'guild-a',
    ownerId: 'owner',
    members: { me: { permissions: { has: () => true } } },
    roles: {
      cache: roleCache,
      fetch: async id => roles.get(id) || null,
      create: async options => {
        createdRoles += 1;
        const role = { id: `role-${nextRoleId++}`, name: options.name, icon: options.icon, editable: true };
        roles.set(role.id, role);
        return role;
      },
    },
  };
  const member = {
    id: 'member-a',
    guild,
    manageable: true,
    roles: {
      cache: { has: roleId => memberRoleIds.has(roleId) },
      add: async role => memberRoleIds.add(role.id),
      remove: async roleIds => roleIds.forEach(roleId => memberRoleIds.delete(roleId)),
    },
  };
  const database = {
    getLevelBadgeRoleId: (guildId, level) => badgeRoleIds.get(`${guildId}:${level}`) || null,
    setLevelBadgeRole: (guildId, level, roleId) => badgeRoleIds.set(`${guildId}:${level}`, roleId),
    getLevelBadgeRoles: guildId => [...badgeRoleIds.entries()]
      .filter(([key]) => key.startsWith(`${guildId}:`))
      .map(([key, role_id]) => ({ level: Number(key.split(':')[1]), role_id })),
  };

  assert.equal(await syncLevelBadge(member, 6, database), true);
  const levelSixRoleId = badgeRoleIds.get('guild-a:6');
  assert.equal(roles.get(levelSixRoleId).name, 'Level 6');
  assert.ok(Buffer.isBuffer(roles.get(levelSixRoleId).icon));
  assert.deepEqual([...memberRoleIds], [levelSixRoleId]);

  assert.equal(await syncLevelBadge(member, 7, database), true);
  const levelSevenRoleId = badgeRoleIds.get('guild-a:7');
  assert.deepEqual([...memberRoleIds], [levelSevenRoleId]);
  assert.equal(createdRoles, 2);

  assert.equal(await syncLevelBadge(member, 7, database), true);
  assert.equal(createdRoles, 2);
});