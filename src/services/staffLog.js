const { v4: uuidv4 } = require('uuid');

function nextCaseId(db) {
  const id = `C-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${uuidv4().slice(0, 8).toUpperCase()}`;
  return id;
}

function createStaffLog(db) {
  const insert = db.raw.prepare(`INSERT INTO staff_log (case_id, actor_discord_id, target_discord_id, target_uuid, target_name, action, reason, result, metadata)
    VALUES (@case_id, @actor_discord_id, @target_discord_id, @target_uuid, @target_name, @action, @reason, @result, @metadata)`);

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
    allForExport() {
      return db.raw.prepare('SELECT * FROM staff_log ORDER BY id ASC').all();
    }
  };
}

module.exports = { createStaffLog, nextCaseId };
