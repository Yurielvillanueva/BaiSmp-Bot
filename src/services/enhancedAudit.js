const crypto = require('crypto');
const { logger } = require('../logger');

function createEnhancedAuditService(db) {
  return {
    async logEntry(entry) {
      const auditId = this.generateAuditId();
      const hash = this.hashEntry(entry);

      db.raw.prepare(`INSERT INTO enhanced_audit (
        audit_id, actor_id, target_id, action, resource, changes,
        ip_hash, user_agent, session_id, severity, metadata,
        blockchain_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        auditId,
        entry.actorId,
        entry.targetId,
        entry.action,
        entry.resource,
        JSON.stringify(entry.changes || {}),
        entry.ipHash,
        entry.userAgent,
        entry.sessionId,
        entry.severity || 'info',
        JSON.stringify(entry.metadata || {}),
        hash,
        Date.now()
      );

      return auditId;
    },

    generateAuditId() {
      const timestamp = Date.now().toString(36);
      const random = crypto.randomBytes(4).toString('hex');
      return `AUD-${timestamp}-${random}`.toUpperCase();
    },

    hashEntry(entry) {
      const data = JSON.stringify({
        actor: entry.actorId,
        target: entry.targetId,
        action: entry.action,
        resource: entry.resource,
        changes: entry.changes,
        timestamp: Date.now()
      });
      return crypto.createHash('sha256').update(data).digest('hex');
    },

    async verifyIntegrity(auditId) {
      const entry = db.raw.prepare('SELECT * FROM enhanced_audit WHERE audit_id = ?').get(auditId);
      if (!entry) return { valid: false, reason: 'NOT_FOUND' };

      const currentHash = this.hashEntry({
        actorId: entry.actor_id,
        targetId: entry.target_id,
        action: entry.action,
        resource: entry.resource,
        changes: JSON.parse(entry.changes)
      });

      const valid = currentHash === entry.blockchain_hash;
      return { valid, reason: valid ? 'OK' : 'HASH_MISMATCH' };
    },

    async getAuditTrail(discordId, limit = 100) {
      return db.raw.prepare(`
        SELECT * FROM enhanced_audit
        WHERE actor_id = ? OR target_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(discordId, discordId, limit);
    },

    async getResourceHistory(resource, resourceId, limit = 50) {
      return db.raw.prepare(`
        SELECT * FROM enhanced_audit
        WHERE resource = ? AND target_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(resource, resourceId, limit);
    },

    async getHighSeverityEvents(limit = 50) {
      return db.raw.prepare(`
        SELECT * FROM enhanced_audit
        WHERE severity IN ('warning', 'critical', 'emergency')
        ORDER BY created_at DESC
        LIMIT ?
      `).all(limit);
    },

    async getSecurityEvents(days = 7) {
      const cutoff = Date.now() - (days * 86400000);
      return db.raw.prepare(`
        SELECT * FROM enhanced_audit
        WHERE resource IN ('auth', 'session', '2fa', 'security')
          AND created_at >= ?
        ORDER BY created_at DESC
      `).all(cutoff);
    },

    async generateReport(filters = {}) {
      let query = 'SELECT * FROM enhanced_audit WHERE 1=1';
      const params = [];

      if (filters.actorId) {
        query += ' AND actor_id = ?';
        params.push(filters.actorId);
      }

      if (filters.resource) {
        query += ' AND resource = ?';
        params.push(filters.resource);
      }

      if (filters.severity) {
        query += ' AND severity = ?';
        params.push(filters.severity);
      }

      if (filters.startDate) {
        query += ' AND created_at >= ?';
        params.push(filters.startDate);
      }

      if (filters.endDate) {
        query += ' AND created_at <= ?';
        params.push(filters.endDate);
      }

      query += ' ORDER BY created_at DESC';

      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
      }

      return db.raw.prepare(query).all(...params);
    },

    async createEnhancedAuditTable() {
      db.raw.prepare(`CREATE TABLE IF NOT EXISTS enhanced_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        audit_id TEXT UNIQUE NOT NULL,
        actor_id TEXT NOT NULL,
        target_id TEXT,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        changes TEXT,
        ip_hash TEXT,
        user_agent TEXT,
        session_id TEXT,
        severity TEXT NOT NULL DEFAULT 'info',
        metadata TEXT,
        blockchain_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`).run();

      db.raw.prepare('CREATE INDEX IF NOT EXISTS idx_audit_actor ON enhanced_audit(actor_id)').run();
      db.raw.prepare('CREATE INDEX IF NOT EXISTS idx_audit_target ON enhanced_audit(target_id)').run();
      db.raw.prepare('CREATE INDEX IF NOT EXISTS idx_audit_resource ON enhanced_audit(resource)').run();
      db.raw.prepare('CREATE INDEX IF NOT EXISTS idx_audit_severity ON enhanced_audit(severity)').run();
      db.raw.prepare('CREATE INDEX IF NOT EXISTS idx_audit_created ON enhanced_audit(created_at)').run();
    }
  };
}

module.exports = { createEnhancedAuditService };
