const { sha256, randomCode } = require('../util/crypto');
const { cfg } = require('../config/store');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function mojangProfile(username) {
  const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('mojang_unavailable');
  const data = await res.json();
  const raw = data.id;
  const uuid = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
  return { uuid, username: data.name };
}

async function mojangName(uuid) {
  const compact = uuid.replaceAll('-', '');
  const res = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${compact}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.name;
}

function dashedUuid(uuid) {
  const raw = String(uuid).replaceAll('-', '').toLowerCase();
  if (raw.length !== 32) return null;
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

function createLinkService(db) {
  function linkAccount({ discordId, uuid, username }) {
    const max = cfg(db, 'max_links_per_discord');
    const existing = db.raw.prepare('SELECT * FROM linked_accounts WHERE minecraft_uuid = ?').get(uuid);
    if (existing && existing.discord_id !== discordId) {
      throw new Error('UUID_TAKEN');
    }
    const count = db.raw.prepare('SELECT COUNT(*) AS c FROM linked_accounts WHERE discord_id = ?').get(discordId).c;
    if (!existing && count >= max) {
      throw new Error('LINK_LIMIT');
    }
    db.raw.prepare(`INSERT INTO linked_accounts (discord_id, minecraft_uuid, username)
      VALUES (?, ?, ?)
      ON CONFLICT(minecraft_uuid) DO UPDATE SET discord_id = excluded.discord_id, username = excluded.username`)
      .run(discordId, uuid, username);
  }

  return {
    storeCode(code, uuid, username) {
      const ttl = cfg(db, 'link_code_ttl_minutes') * 60 * 1000;
      db.raw.prepare('INSERT INTO link_codes (code_hash, minecraft_uuid, username, expires_at, used) VALUES (?, ?, ?, ?, 0)')
        .run(sha256(String(code).trim().toUpperCase()), dashedUuid(uuid) || uuid, username, Date.now() + ttl);
      return String(code).trim().toUpperCase();
    },
    createCode(uuid, username) {
      const code = randomCode(6);
      this.storeCode(code, uuid, username);
      return code;
    },
    consume(code) {
      const hash = sha256(String(code).trim().toUpperCase());
      const row = db.raw.prepare('SELECT * FROM link_codes WHERE code_hash = ?').get(hash);
      if (!row || row.used || row.expires_at < Date.now()) return null;
      const result = db.raw.prepare('UPDATE link_codes SET used = 1 WHERE id = ? AND used = 0 AND expires_at >= ?')
        .run(row.id, Date.now());
      if (result.changes !== 1) return null;
      return row;
    },
    completeLink(code, discordId) {
      const hash = sha256(String(code).trim().toUpperCase());
      return db.raw.transaction(() => {
        const row = db.raw.prepare('SELECT * FROM link_codes WHERE code_hash = ?').get(hash);
        if (!row || row.used || row.expires_at < Date.now()) return null;
        linkAccount({ discordId, uuid: row.minecraft_uuid, username: row.username });
        const result = db.raw.prepare('UPDATE link_codes SET used = 1 WHERE id = ? AND used = 0 AND expires_at >= ?')
          .run(row.id, Date.now());
        if (result.changes !== 1) return null;
        return row;
      }).immediate();
    },
    countForDiscord(discordId) {
      return db.raw.prepare('SELECT COUNT(*) AS c FROM linked_accounts WHERE discord_id = ?').get(discordId).c;
    },
    getByDiscord(discordId) {
      return db.raw.prepare('SELECT * FROM linked_accounts WHERE discord_id = ?').all(discordId);
    },
    getByUuid(uuid) {
      return db.raw.prepare('SELECT * FROM linked_accounts WHERE minecraft_uuid = ?').get(uuid);
    },
    link({ discordId, uuid, username }) {
      linkAccount({ discordId, uuid, username });
    },
    unlink(discordId) {
      db.raw.prepare('DELETE FROM linked_accounts WHERE discord_id = ?').run(discordId);
    },
    unlinkMinecraft({ discordId, uuid }) {
      db.raw.prepare('DELETE FROM linked_accounts WHERE discord_id = ? AND minecraft_uuid = ?')
        .run(discordId, dashedUuid(uuid) || uuid);
    },
    async refreshUsername(row) {
      const name = await mojangName(row.minecraft_uuid);
      if (name && name !== row.username) {
        db.raw.prepare('UPDATE linked_accounts SET username = ? WHERE id = ?').run(name, row.id);
        return name;
      }
      return row.username;
    },
    whois({ discordId, username, uuid }) {
      if (discordId) return this.getByDiscord(discordId);
      if (uuid) {
        const row = this.getByUuid(dashedUuid(uuid) || uuid);
        return row ? [row] : [];
      }
      return db.raw.prepare('SELECT * FROM linked_accounts WHERE username = ? COLLATE NOCASE').all(username);
    }
  };
}

module.exports = { createLinkService, mojangProfile, mojangName, dashedUuid, UUID_RE };
