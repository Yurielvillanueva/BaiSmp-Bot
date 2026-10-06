const { parseDuration } = require('../util/sanitize');
const { sendRcon } = require('./rcon');
const { cfg } = require('../config/store');
const { nextCaseId } = require('./staffLog');

function createModerationService(ctx) {
  const { db, env } = ctx;

  function insertPunishment({ caseId, type, targetDiscordId, targetUuid, targetName, durationMs, reason }) {
    const expires = durationMs ? Date.now() + durationMs : null;
    db.raw.prepare(`INSERT INTO punishments (case_id, type, target_discord_id, target_uuid, target_name, duration_ms, expires_at, active, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(caseId, type, targetDiscordId || null, targetUuid || null, targetName, durationMs || null, expires, reason);
  }

  async function applyDiscord(guild, type, targetDiscordId, durationMs) {
    if (!targetDiscordId) return;
    const member = await guild.members.fetch(targetDiscordId).catch(() => null);
    if (type === 'mute' || type === 'tempmute') {
      const muted = cfg(db, 'muted_role_id');
      if (muted && member) await member.roles.add(muted);
      if (member?.moderatable && durationMs) await member.timeout(Math.min(durationMs, 28 * 86400000), 'MC Bridge mute').catch(() => {});
    }
    if (type === 'kick' && member?.kickable) await member.kick('MC Bridge kick');
    if (type === 'ban' || type === 'tempban') {
      await guild.bans.create(targetDiscordId, { reason: 'MC Bridge ban' }).catch(() => {});
    }
  }

  async function applyMinecraft(type, targetName, durationLabel, reason) {
    const server = db.servers.all()[0];
    if (!server || !targetName) return;
    const r = reason || 'staff action';
    if (type === 'kick') await sendRcon(env, db, server, `kick ${targetName} ${r}`);
    if (type === 'ban') await sendRcon(env, db, server, `ban ${targetName} ${r}`);
    if (type === 'tempban') await sendRcon(env, db, server, `tempban ${targetName} ${durationLabel} ${r}`).catch(async () => {
      await sendRcon(env, db, server, `ban ${targetName} ${r}`);
    });
    if (type === 'mute' || type === 'tempmute') {
      await sendRcon(env, db, server, `mute ${targetName} ${durationLabel || '10y'} ${r}`).catch(() => {});
    }
    if (type === 'warn') await sendRcon(env, db, server, `say ${targetName} received a warning: ${r}`).catch(() => {});
  }

  async function escalate(targetDiscordId, targetName, actorId, guild) {
    const days = cfg(db, 'escalation_window_days');
    const need = cfg(db, 'escalation_warns');
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const count = db.raw.prepare(`SELECT COUNT(*) AS c FROM staff_log WHERE action = 'warn' AND (target_discord_id = ? OR target_name = ?) AND created_at >= ?`)
      .get(targetDiscordId || '', targetName || '', since).c;
    if (count >= need) {
      await this.punish({
        guild,
        actorId,
        type: 'tempmute',
        targetDiscordId,
        targetName,
        duration: cfg(db, 'escalation_mute'),
        reason: `Automatic escalation: ${count} warns in ${days}d`
      });
    }
  }

  return {
    async punish({ guild, actorId, type, targetDiscordId, targetUuid, targetName, duration, reason }) {
      const durationMs = duration ? parseDuration(duration) : null;
      const caseId = nextCaseId(db);
      insertPunishment({ caseId, type, targetDiscordId, targetUuid, targetName, durationMs, reason });
      await applyDiscord(guild, type, targetDiscordId, durationMs);
      await applyMinecraft(type, targetName, duration, reason);
      ctx.staffLog.add({
        caseId,
        actorId,
        targetDiscordId,
        targetUuid,
        targetName,
        action: type,
        reason,
        result: 'applied'
      });
      if (type === 'warn') await escalate.call(this, targetDiscordId, targetName, actorId, guild);
      return caseId;
    },
    async liftExpired(guild) {
      const rows = db.raw.prepare('SELECT * FROM punishments WHERE active = 1 AND expires_at IS NOT NULL AND expires_at <= ?').all(Date.now());
      const server = db.servers.all()[0];
      const muted = cfg(db, 'muted_role_id');
      for (const row of rows) {
        db.raw.prepare('UPDATE punishments SET active = 0 WHERE id = ?').run(row.id);
        if ((row.type === 'tempban' || row.type === 'ban') && row.target_discord_id) {
          await guild.bans.remove(row.target_discord_id).catch(() => {});
        }
        if ((row.type === 'tempmute' || row.type === 'mute') && row.target_discord_id && muted) {
          const member = await guild.members.fetch(row.target_discord_id).catch(() => null);
          if (member) await member.roles.remove(muted).catch(() => {});
          if (member) await member.timeout(null).catch(() => {});
        }
        if (server && row.target_name) {
          if (row.type === 'tempban' || row.type === 'ban') {
            await sendRcon(env, db, server, `pardon ${row.target_name}`).catch(() => {});
          }
          if (row.type === 'tempmute' || row.type === 'mute') {
            await sendRcon(env, db, server, `unmute ${row.target_name}`).catch(() => {});
          }
        }
        ctx.staffLog.add({
          actorId: 'system',
          targetDiscordId: row.target_discord_id,
          targetUuid: row.target_uuid,
          targetName: row.target_name,
          action: 'expire',
          reason: `Expired ${row.type}`,
          result: 'lifted',
          caseId: row.case_id
        });
      }
    },
    async syncBans(guild) {
      const bans = await guild.bans.fetch().catch(() => null);
      if (!bans) return;
      const server = db.servers.all()[0];
      if (!server) return;
      for (const ban of bans.values()) {
        const linked = db.raw.prepare('SELECT * FROM linked_accounts WHERE discord_id = ?').get(ban.user.id);
        if (linked) {
          await sendRcon(env, db, server, `ban ${linked.username} Discord ban sync`).catch(() => {});
        }
      }
    },
    getActiveByCase(caseId) {
      return db.raw.prepare('SELECT * FROM punishments WHERE case_id = ? AND active = 1').get(caseId);
    },
    async liftByCase(guild, caseId) {
      const row = this.getActiveByCase(caseId);
      if (!row) return null;
      db.raw.prepare('UPDATE punishments SET active = 0 WHERE id = ?').run(row.id);
      const server = db.servers.all()[0];
      if (row.target_discord_id) await guild.bans.remove(row.target_discord_id).catch(() => {});
      const muted = cfg(db, 'muted_role_id');
      if (muted && row.target_discord_id) {
        const member = await guild.members.fetch(row.target_discord_id).catch(() => null);
        if (member) {
          await member.roles.remove(muted).catch(() => {});
          await member.timeout(null).catch(() => {});
        }
      }
      if (server && row.target_name) {
        await sendRcon(env, db, server, `pardon ${row.target_name}`).catch(() => {});
        await sendRcon(env, db, server, `unmute ${row.target_name}`).catch(() => {});
      }
      return row;
    }
  };
}

module.exports = { createModerationService };
