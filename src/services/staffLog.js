const { v4: uuidv4 } = require('uuid');

function nextCaseId(_db) {
  const id = `C-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${uuidv4().slice(0, 8).toUpperCase()}`;
  return id;
}

function createStaffLog(db) {
  const insert = db.raw.prepare(`INSERT INTO staff_log (case_id, actor_discord_id, target_discord_id, target_uuid, target_name, action, reason, result, metadata)
    VALUES (@case_id, @actor_discord_id, @target_discord_id, @target_uuid, @target_name, @action, @reason, @result, @metadata)`);
  const moderationActions = ['warn', 'mute', 'tempmute', 'kick', 'ban', 'tempban'];

  return {
    add({ actorId, targetDiscordId, targetUuid, targetName, action, reason, result, metadata, caseId }) {
      const id = caseId || nextCaseId(db);
      insert.run({
        case_id: id,
        actor_discord_id: actorId,
        target_discord_id: targetDiscordId || null,
        target_uuid: targetUuid || null,
        target_name: targetName || null,
        action,
        reason: reason || null,
        result: result || null,
        metadata: metadata ? JSON.stringify(metadata) : null
      });
      return id;
    },
    viewPlayer(name) {
      return db.raw.prepare(`SELECT * FROM staff_log WHERE target_name = ? OR target_uuid = ? ORDER BY id DESC LIMIT 50`).all(name, name);
    },
    search({ action, query, limit = 50 }) {
      const like = `%${query || ''}%`;
      return db.raw.prepare(`SELECT * FROM staff_log
        WHERE (@action IS NULL OR action = @action)
          AND (reason LIKE @like OR target_name LIKE @like OR case_id LIKE @like OR actor_discord_id LIKE @like)
        ORDER BY id DESC LIMIT @limit`).all({ action: action || null, like, limit });
    },
    getByCase(caseId) {
      return db.raw.prepare('SELECT * FROM staff_log WHERE case_id = ?').get(caseId);
    },
    activity({ since, actorId, limit = 10 }) {
      return db.raw.prepare(`SELECT actor_discord_id, action, COUNT(*) AS count
        FROM staff_log
        WHERE (@since IS NULL OR created_at >= @since)
          AND (@actorId IS NULL OR actor_discord_id = @actorId)
        GROUP BY actor_discord_id, action
        ORDER BY count DESC, actor_discord_id ASC, action ASC
        LIMIT @limit`).all({ since: since || null, actorId: actorId || null, limit });
    },
    moderationSummary({ since }) {
      const placeholders = moderationActions.map(() => '?').join(', ');
      const rows = db.raw.prepare(`SELECT action, COUNT(*) AS count
        FROM staff_log
        WHERE action IN (${placeholders})
          AND (? IS NULL OR created_at >= ?)
        GROUP BY action
        ORDER BY count DESC, action ASC`).all(...moderationActions, since || null, since || null);
      return {
        total: rows.reduce((sum, row) => sum + row.count, 0),
        actions: rows
      };
    },
    auditSearch({ since, actorId, action, limit = 15 }) {
      return db.raw.prepare(`SELECT * FROM staff_log
        WHERE (@since IS NULL OR created_at >= @since)
          AND (@actorId IS NULL OR actor_discord_id = @actorId)
          AND (@action IS NULL OR action = @action)
        ORDER BY id DESC
        LIMIT @limit`).all({
        since: since || null,
        actorId: actorId || null,
        action: action || null,
        limit
      });
    },
    allForExport() {
      return db.raw.prepare('SELECT * FROM staff_log ORDER BY id ASC').all();
    }
  };
}

module.exports = { createStaffLog, nextCaseId };
