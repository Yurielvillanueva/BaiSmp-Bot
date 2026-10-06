const { sendRcon } = require('./rcon');
const { cfg } = require('../config/store');

function createRewardsService(ctx) {
  const { db, env } = ctx;

  return {
    recordVote({ username, uuid, service }) {
      db.raw.prepare('INSERT INTO votes (username, uuid, service, created_at) VALUES (?, ?, ?, ?)').run(username, uuid || null, service || 'votifier', Date.now());
    },
    streak(username) {
      const rows = db.raw.prepare('SELECT created_at FROM votes WHERE username = ? ORDER BY created_at DESC LIMIT 60').all(username);
      let streak = 0;
      let day = new Date();
      day.setHours(0, 0, 0, 0);
      for (;;) {
        const start = day.getTime();
        const end = start + 86400000;
        const hit = rows.some((r) => r.created_at >= start && r.created_at < end);
        if (!hit) break;
        streak += 1;
        day = new Date(day.getTime() - 86400000);
      }
      return streak;
    },
    count(username) {
      return db.raw.prepare('SELECT COUNT(*) AS c FROM votes WHERE username = ?').get(username).c;
    },
    top(limit = 10) {
      return db.raw.prepare('SELECT username, COUNT(*) AS votes FROM votes GROUP BY username ORDER BY votes DESC LIMIT ?').all(limit);
    },
    async rewardVote(username) {
      const server = db.servers.all()[0];
      const cmd = String(cfg(db, 'vote_reward_command') || '').replaceAll('{name}', username);
      if (server && cmd) await sendRcon(env, db, server, cmd);
    },
    async daily(discordId, username) {
      const cd = cfg(db, 'daily_cooldown_hours') * 3600000;
      const row = db.raw.prepare('SELECT * FROM daily_claims WHERE discord_id = ?').get(discordId);
      const now = Date.now();
      if (row && now - row.last_claim_at < cd) {
        const err = new Error('DAILY_COOLDOWN');
        err.waitMs = cd - (now - row.last_claim_at);
        throw err;
      }
      let streak = 1;
      if (row && now - row.last_claim_at < cd + 86400000) streak = row.streak + 1;
      db.raw.prepare(`INSERT INTO daily_claims (discord_id, streak, last_claim_at) VALUES (?, ?, ?)
        ON CONFLICT(discord_id) DO UPDATE SET streak = excluded.streak, last_claim_at = excluded.last_claim_at`)
        .run(discordId, streak, now);
      const server = db.servers.all()[0];
      const cmd = String(cfg(db, 'daily_reward_command') || '').replaceAll('{name}', username);
      if (server && cmd) await sendRcon(env, db, server, cmd);
      return streak;
    },
    async booster(uuid) {
      const server = db.servers.all()[0];
      const cmd = String(cfg(db, 'booster_reward_command') || '').replaceAll('{uuid}', uuid);
      if (server && cmd) await sendRcon(env, db, server, cmd);
    }
  };
}

module.exports = { createRewardsService };
