const fs = require('fs');
const path = require('path');
const { pluginGet } = require('./pluginClient');
const { dashedUuid } = require('./linking');

function readWorldStats(worldPath, uuid) {
  if (!worldPath) return null;
  const compact = uuid.replaceAll('-', '');
  const file = path.join(worldPath, 'stats', `${compact}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function flattenStats(raw) {
  const stats = raw.stats || raw;
  const custom = stats['minecraft:custom'] || {};
  const mined = stats['minecraft:mined'] || {};
  const minedTotal = Object.values(mined).reduce((a, b) => a + Number(b || 0), 0);
  return {
    playtimeMin: Math.floor((custom['minecraft:play_time'] || custom['minecraft:play_one_minute'] || 0) / 20 / 60),
    deaths: custom['minecraft:deaths'] || 0,
    mobKills: custom['minecraft:mob_kills'] || 0,
    playerKills: custom['minecraft:player_kills'] || 0,
    mined: minedTotal,
    walkCm: custom['minecraft:walk_one_cm'] || 0,
    joins: custom['minecraft:leave_game'] || custom['minecraft:play_time'] ? (custom['minecraft:leave_game'] || 0) + 1 : 0,
    raw
  };
}

function createStatsService(ctx) {
  const { env, db, cache } = ctx;

  async function forPlayer(username, uuid) {
    const key = uuid || username;
    const cached = await cache.getStats(key);
    if (cached) return cached;

    const server = db.servers.all()[0];
    let raw;
    if (server?.plugin_api_url && uuid) {
      try {
        raw = await pluginGet(env, server, `/v1/stats/${uuid}`);
      } catch {
        raw = null;
      }
    }
    if (!raw && server?.world_path && uuid) {
      raw = readWorldStats(server.world_path, dashedUuid(uuid) || uuid);
    }
    if (!raw) throw new Error('NO_STATS');
    const data = flattenStats(raw);
    data.username = username;
    data.uuid = uuid;
    data.head = `https://mc-heads.net/avatar/${uuid || username}/64`;
    await cache.setStats(key, data, 60);
    return data;
  }

  function topFromDb(kind) {
    const linked = db.raw.prepare('SELECT username, minecraft_uuid FROM linked_accounts').all();
    return { kind, linked };
  }

  async function invalidatePlayer(uuid) {
    await cache.invalidateStats(uuid);
  }

  return { forPlayer, topFromDb, flattenStats, readWorldStats, invalidatePlayer };
}

module.exports = { createStatsService, flattenStats };
