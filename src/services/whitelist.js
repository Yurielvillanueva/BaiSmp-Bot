const { mojangProfile } = require('./linking');
const { sendRcon } = require('./rcon');
const { floodgateName } = require('../util/sanitize');
const { cfg } = require('../config/store');
const { embed } = require('../util/embeds');

function createWhitelistService(ctx) {
  const { db, env } = ctx;

  return {
    async apply({ discordId, username, reason, linked }) {
      let uuid = linked?.minecraft_uuid || null;
      let name = username || linked?.username;
      if (!name) throw new Error('NEED_NAME');
      name = floodgateName(name, cfg(db, 'floodgate_prefix'));
      if (!name.startsWith(cfg(db, 'floodgate_prefix'))) {
        const profile = await mojangProfile(name);
        if (!profile) throw new Error('INVALID_NAME');
        uuid = profile.uuid;
        name = profile.username;
      }
      const info = db.raw.prepare(`INSERT INTO whitelist_apps (discord_id, username, uuid, reason, status)
        VALUES (?, ?, ?, ?, 'pending')`).run(discordId, name, uuid, reason || '');
      return db.raw.prepare('SELECT * FROM whitelist_apps WHERE id = ?').get(info.lastInsertRowid);
    },
    async decide(ctxFull, appId, approve, actorId, guild) {
      const app = db.raw.prepare('SELECT * FROM whitelist_apps WHERE id = ?').get(appId);
      if (!app || app.status !== 'pending') throw new Error('NOT_PENDING');
      const server = db.servers.all()[0];
      db.raw.prepare('UPDATE whitelist_apps SET status = ? WHERE id = ?').run(approve ? 'approved' : 'denied', appId);
      const caseId = ctxFull.staffLog.add({
        actorId,
        targetDiscordId: app.discord_id,
        targetUuid: app.uuid,
        targetName: app.username,
        action: approve ? 'whitelist_approve' : 'whitelist_deny',
        reason: app.reason,
        result: approve ? 'approved' : 'denied'
      });
      if (approve && server) {
        await sendRcon(env, db, server, `whitelist add ${app.username}`);
        const roleId = cfg(db, 'whitelisted_role_id');
        if (roleId && guild) {
          const member = await guild.members.fetch(app.discord_id).catch(() => null);
          if (member) await member.roles.add(roleId).catch(() => {});
        }
        const user = await ctxFull.client.users.fetch(app.discord_id).catch(() => null);
        if (user) {
          await user.send({ embeds: [embed(db, { title: 'Whitelist approved', description: `You were added as \`${app.username}\`.` })] }).catch(() => {});
        }
      }
      return { app, caseId };
    },
    async remove(username) {
      const server = db.servers.all()[0];
      await sendRcon(env, db, server, `whitelist remove ${username}`);
      return true;
    },
    async list() {
      const server = db.servers.all()[0];
      const { result } = await sendRcon(env, db, server, 'whitelist list');
      return result;
    },
    pending() {
      return db.raw.prepare("SELECT * FROM whitelist_apps WHERE status = 'pending' ORDER BY id DESC").all();
    }
  };
}

module.exports = { createWhitelistService };
