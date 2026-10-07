const { parseDuration, stripColorCodes } = require('../util/sanitize');
const { sendRcon } = require('./rcon');
const { cfg } = require('../config/store');
const { nextCaseId } = require('./staffLog');
const { logger } = require('../logger');

function roundedDuration(ms) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(seconds / 3600);
  if (hours < 48) return `${hours}h`;
  return `${Math.ceil(seconds / 86400)}d`;
}

function parseAdvancedBanDuration(input) {
  const match = String(input || '').trim().match(/^(\d+)(mo|s|m|h|d|w)$/i);
  if (!match) return null;
  const units = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
    mo: 2_592_000_000
  };
  const durationMs = Number(match[1]) * units[match[2].toLowerCase()];
  return Number.isSafeInteger(durationMs) && durationMs > 0 ? durationMs : null;
}

function assertAdvancedBanResponse(result, action) {
  const response = stripColorCodes(result).trim();
  if (!response) throw new Error('ADVANCEDBAN_UNCONFIRMED');
  if (/unknown command|invalid duration|no permission|don't have perms|not able to ban more than|not found|not (?:currently )?banned|already (?:been )?(?:un)?banned|already been banned|\berror\b|\bfailed\b|usage:|could not fetch the uuid/i.test(response)) {
    throw new Error('ADVANCEDBAN_COMMAND_FAILED');
  }
  const confirmed = action === 'unban'
    ? /successfully unbanned/i.test(response)
    : /got banned by|temporarily banned|successfully tempbanned/i.test(response);
  if (!confirmed) throw new Error('ADVANCEDBAN_UNCONFIRMED');
}

async function sendAdvancedBan(env, db, server, command, action) {
  const { result } = await sendRcon(env, db, server, command);
  assertAdvancedBanResponse(result, action);
}

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
      const durationMs = duration ? (type === 'tempban' ? parseAdvancedBanDuration(duration) : parseDuration(duration)) : null;
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
    getActiveByPlayer(username) {
      return db.raw.prepare(`SELECT * FROM punishments
        WHERE target_name = ? COLLATE NOCASE AND active = 1
          AND (expires_at IS NULL OR expires_at > ?)
          AND type IN ('ban', 'tempban', 'mute', 'tempmute')
        ORDER BY id DESC LIMIT 1`).get(String(username || '').trim(), Date.now());
    },
    historyForTarget({ discordId, uuid, username, limit = 10 }) {
      const matches = [];
      const params = [];
      if (discordId) {
        matches.push('target_discord_id = ?');
        params.push(discordId);
      }
      if (uuid) {
        matches.push('target_uuid = ?');
        params.push(uuid);
      }
      if (username) {
        matches.push('target_name = ? COLLATE NOCASE');
        params.push(username);
      }
      if (!matches.length) throw new Error('TARGET_REQUIRED');
      return db.raw.prepare(`SELECT p.*,
          (SELECT actor_discord_id FROM staff_log s WHERE s.case_id = p.case_id ORDER BY s.id DESC LIMIT 1) AS actor_discord_id
        FROM punishments p
        WHERE ${matches.join(' OR ')}
        ORDER BY p.id DESC
        LIMIT ?`).all(...params, limit);
    },
    async reduceTemporaryBan(caseId, duration, reason) {
      const punishment = this.getActiveByCase(caseId);
      if (!punishment || punishment.type !== 'tempban' || !punishment.expires_at) {
        throw new Error('TEMPBAN_NOT_REDUCIBLE');
      }
      const durationMs = parseAdvancedBanDuration(duration);
      const remainingMs = Number(punishment.expires_at) - Date.now();
      if (!durationMs || durationMs <= 0 || durationMs >= remainingMs) {
        throw new Error('INVALID_REDUCED_DURATION');
      }
      if (!/^[A-Za-z0-9_.-]{1,32}$/.test(punishment.target_name || '')) {
        throw new Error('INVALID_TARGET_NAME');
      }
      const server = db.servers.all()[0];
      if (!server) throw new Error('SERVER_NOT_CONFIGURED');

      const oldRemaining = Math.max(1000, remainingMs);
      const oldDuration = roundedDuration(oldRemaining);
      const note = String(reason || 'Appeal approved with reduced duration').replace(/[\r\n\0]/g, ' ').slice(0, 180);
      const restore = async (originalError) => {
        try {
          await sendAdvancedBan(env, db, server, `tempban ${punishment.target_name} ${oldDuration} Restore original appeal punishment`, 'tempban');
        } catch (restoreError) {
          originalError.restoreError = restoreError;
          logger.error({ err: originalError, restoreError, caseId }, 'failed to restore original AdvancedBan tempban after reduction failure');
        }
      };
      try {
        await sendAdvancedBan(env, db, server, `unban ${punishment.target_name}`, 'unban');
      } catch (err) {
        if (err.message !== 'ADVANCEDBAN_COMMAND_FAILED') await restore(err);
        throw err;
      }
      try {
        await sendAdvancedBan(env, db, server, `tempban ${punishment.target_name} ${duration} ${note}`, 'tempban');
      } catch (err) {
        await restore(err);
        throw err;
      }

      const expiresAt = Date.now() + durationMs;
      db.raw.prepare(`UPDATE punishments SET duration_ms = ?, expires_at = ?
        WHERE id = ? AND active = 1`).run(durationMs, expiresAt, punishment.id);
      return { ...punishment, duration_ms: durationMs, expires_at: expiresAt };
    },
    async liftByCase(guild, caseId) {
      const row = this.getActiveByCase(caseId);
      if (!row) return null;
      const server = db.servers.all()[0];
      if (row.type === 'ban' || row.type === 'tempban') {
        if (row.target_discord_id) {
          try {
            await guild.bans.remove(row.target_discord_id, 'Accepted punishment appeal');
          } catch (err) {
            if (err.code !== 10026) throw err;
          }
        }
        if (server && row.target_name) {
          await sendRcon(env, db, server, `pardon ${row.target_name}`);
        }
      } else if (row.type === 'mute' || row.type === 'tempmute') {
        const muted = cfg(db, 'muted_role_id');
        if (row.target_discord_id) {
          let member;
          try {
            member = await guild.members.fetch(row.target_discord_id);
          } catch (err) {
            if (err.code !== 10007) throw err;
          }
          if (member && muted && member.roles.cache.has(muted)) {
            await member.roles.remove(muted, 'Accepted punishment appeal');
          }
          if (member?.communicationDisabledUntilTimestamp) {
            await member.timeout(null, 'Accepted punishment appeal');
          }
        }
        if (server && row.target_name) {
          await sendRcon(env, db, server, `unmute ${row.target_name}`);
        }
      } else {
        throw new Error('PUNISHMENT_NOT_REVERSIBLE');
      }
      db.raw.prepare('UPDATE punishments SET active = 0 WHERE id = ? AND active = 1').run(row.id);
      return row;
    }
  };
}

module.exports = { createModerationService, assertAdvancedBanResponse, parseAdvancedBanDuration };
