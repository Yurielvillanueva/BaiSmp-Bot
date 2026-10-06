const crypto = require('crypto');
const { hashIp } = require('../util/crypto');
const { logger } = require('../logger');

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function generateDeviceFingerprint(userAgent, ip) {
  const normalized = (userAgent || '').replace(/\/\d+\.\d+\./g, '/').replace(/\s*\([^)]*\)\s*/g, ' ');
  const hash = crypto.createHash('sha256').update(normalized + hashIp(ip, 'fingerprint')).digest('hex');
  return hash.slice(0, 16);
}

function createSessionService(db) {
  return {
    async create(discordId, ip, userAgent, ttl = 8 * 3600 * 1000) {
      const sessionId = generateSessionId();
      const ipHash = hashIp(ip, 'session');
      const fingerprint = generateDeviceFingerprint(userAgent, ip);
      const expiresAt = Date.now() + ttl;

      db.raw.prepare(`INSERT INTO user_sessions (id, discord_id, ip_hash, user_agent, device_fingerprint, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(sessionId, discordId, ipHash, userAgent, fingerprint, expiresAt);

      this.logSecurityEvent(discordId, 'session_created', { sessionId, fingerprint }, ipHash, 'info');

      return sessionId;
    },

    async validate(sessionId) {
      const row = db.raw.prepare('SELECT * FROM user_sessions WHERE id = ? AND valid = 1').get(sessionId);
      if (!row) return null;

      if (row.expires_at < Date.now()) {
        this.invalidate(sessionId);
        return null;
      }

      db.raw.prepare('UPDATE user_sessions SET last_used_at = datetime("now") WHERE id = ?').run(sessionId);
      return row;
    },

    async invalidate(sessionId) {
      const row = db.raw.prepare('SELECT * FROM user_sessions WHERE id = ?').get(sessionId);
      if (row) {
        db.raw.prepare('UPDATE user_sessions SET valid = 0 WHERE id = ?').run(sessionId);
        this.logSecurityEvent(row.discord_id, 'session_invalidated', { sessionId }, row.ip_hash, 'info');
      }
    },

    async invalidateAll(discordId) {
      const rows = db.raw.prepare('SELECT * FROM user_sessions WHERE discord_id = ? AND valid = 1').all(discordId);
      for (const row of rows) {
        this.invalidate(row.id);
      }
    },

    async listSessions(discordId) {
      return db.raw.prepare('SELECT * FROM user_sessions WHERE discord_id = ? AND valid = 1 ORDER BY last_used_at DESC').all(discordId);
    },

    async getActiveCount(discordId) {
      const count = db.raw.prepare('SELECT COUNT(*) AS c FROM user_sessions WHERE discord_id = ? AND valid = 1 AND expires_at > ?')
        .get(discordId, Date.now()).c;
      return count;
    },

    async cleanup() {
      const cutoff = Date.now();
      db.raw.prepare('DELETE FROM user_sessions WHERE expires_at < ? OR valid = 0').run(cutoff);
    },

    async logSecurityEvent(discordId, eventType, details, ipHash, severity = 'info') {
      db.raw.prepare(`INSERT INTO security_events (discord_id, event_type, details, ip_hash, severity)
        VALUES (?, ?, ?, ?, ?)`).run(discordId, eventType, JSON.stringify(details), ipHash, severity);
    },

    async getSecurityEvents(discordId, limit = 50) {
      return db.raw.prepare('SELECT * FROM security_events WHERE discord_id = ? ORDER BY id DESC LIMIT ?')
        .all(discordId, limit);
    },

    async getHighSeverityEvents(limit = 100) {
      return db.raw.prepare('SELECT * FROM security_events WHERE severity IN ("warning", "critical") ORDER BY id DESC LIMIT ?')
        .all(limit);
    }
  };
}

module.exports = { createSessionService, generateSessionId, generateDeviceFingerprint };
