const { getDb } = require('./migrate');

function createDb(databasePath) {
  const db = getDb(databasePath);

  return {
    raw: db,
    config: {
      get(key) {
        const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key);
        return row ? JSON.parse(row.value) : undefined;
      },
      getAll() {
        return db.prepare('SELECT key, value FROM app_config').all()
          .reduce((acc, row) => {
            acc[row.key] = JSON.parse(row.value);
            return acc;
          }, {});
      },
      set(key, value, actorId) {
        const old = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key);
        const encoded = JSON.stringify(value);
        db.prepare(`INSERT INTO app_config (key, value, updated_at, updated_by)
          VALUES (?, ?, datetime('now'), ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
          .run(key, encoded, actorId || null);
        db.prepare('INSERT INTO config_audit (key, old_value, new_value, actor_id) VALUES (?, ?, ?, ?)')
          .run(key, old ? old.value : null, encoded, actorId || null);
      }
    },
    servers: {
      all() {
        return db.prepare('SELECT * FROM servers WHERE enabled = 1').all();
      },
      getByName(name) {
        return db.prepare('SELECT * FROM servers WHERE name = ?').get(name);
      },
      get(id) {
        return db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
      },
      upsert(server) {
        db.prepare(`INSERT INTO servers (name, host, rcon_host, query_port, rcon_port, rcon_password_enc, plugin_api_url, world_path, log_path, backup_path, status_channel_id, console_channel_id, chat_channel_id, alert_channel_id, enabled)
          VALUES (@name, @host, @rcon_host, @query_port, @rcon_port, @rcon_password_enc, @plugin_api_url, @world_path, @log_path, @backup_path, @status_channel_id, @console_channel_id, @chat_channel_id, @alert_channel_id, @enabled)
          ON CONFLICT(name) DO UPDATE SET
            host=excluded.host, rcon_host=excluded.rcon_host, query_port=excluded.query_port, rcon_port=excluded.rcon_port,
            rcon_password_enc=excluded.rcon_password_enc, plugin_api_url=excluded.plugin_api_url,
            world_path=excluded.world_path, log_path=excluded.log_path, backup_path=excluded.backup_path,
            status_channel_id=COALESCE(excluded.status_channel_id, servers.status_channel_id),
            console_channel_id=excluded.console_channel_id,
            chat_channel_id=excluded.chat_channel_id, alert_channel_id=excluded.alert_channel_id,
            enabled=excluded.enabled`).run(server);
        return db.prepare('SELECT * FROM servers WHERE name = ?').get(server.name);
      },
      setStatusMessage(id, messageId) {
        db.prepare('UPDATE servers SET status_message_id = ? WHERE id = ?').run(messageId, id);
      },
      setStatusChannel(id, channelId) {
        db.prepare('UPDATE servers SET status_channel_id = ? WHERE id = ?').run(channelId, id);
      },
      setMaintenance(id, on) {
        db.prepare('UPDATE servers SET maintenance = ? WHERE id = ?').run(on ? 1 : 0, id);
      }
    }
  };
}

module.exports = { createDb };
