const { sendRcon } = require('./rcon');
const { logger } = require('../logger');

function createRankSync(ctx) {
  const { db, env } = ctx;

  return {
    mapRole(roleId, group, donor = false, expiresMs = null) {
      db.raw.prepare(`INSERT INTO rank_links (discord_role_id, lp_group, donor, expires_ms) VALUES (?, ?, ?, ?)
        ON CONFLICT(discord_role_id) DO UPDATE SET lp_group = excluded.lp_group, donor = excluded.donor, expires_ms = excluded.expires_ms`)
        .run(roleId, group, donor ? 1 : 0, expiresMs);
    },
    all() {
      return db.raw.prepare('SELECT * FROM rank_links').all();
    },
    async discordToLp(member) {
      const server = db.servers.all()[0];
      const linked = db.raw.prepare('SELECT * FROM linked_accounts WHERE discord_id = ?').get(member.id);
      if (!server || !linked) return;
      for (const link of this.all()) {
        const has = member.roles.cache.has(link.discord_role_id);
        const cmd = has
          ? (link.expires_ms ? `lp user ${linked.minecraft_uuid} parent addtemp ${link.lp_group} ${Math.floor(link.expires_ms / 1000)}s` : `lp user ${linked.minecraft_uuid} parent add ${link.lp_group}`)
          : `lp user ${linked.minecraft_uuid} parent remove ${link.lp_group}`;
        await sendRcon(env, db, server, cmd).catch((err) => logger.warn({ err: err.message }, 'lp sync failed'));
      }
    },
    async lpToDiscord(guild, uuid, groups) {
      const linked = db.raw.prepare('SELECT * FROM linked_accounts WHERE minecraft_uuid = ?').get(uuid);
      if (!linked) return;
      const member = await guild.members.fetch(linked.discord_id).catch(() => null);
      if (!member) return;
      const set = new Set(groups || []);
      for (const link of this.all()) {
        const should = set.has(link.lp_group);
        const has = member.roles.cache.has(link.discord_role_id);
        if (should && !has) await member.roles.add(link.discord_role_id).catch(() => {});
        if (!should && has) await member.roles.remove(link.discord_role_id).catch(() => {});
      }
    }
  };
}

module.exports = { createRankSync };
