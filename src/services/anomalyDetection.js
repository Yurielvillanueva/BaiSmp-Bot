const { logger } = require('../logger');

function createAnomalyDetectionService(db) {
  return {
    async detectAnomaly(discordId, uuid, anomalyType, score, details, threshold = 3.0) {
      if (score < threshold) return null;

      const detectedAt = Date.now();
      const id = db.raw.prepare(`INSERT INTO anomaly_scores (discord_id, minecraft_uuid, anomaly_type, score, threshold, details, detected_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(discordId, uuid, anomalyType, score, threshold, JSON.stringify(details), detectedAt).lastInsertRowid;

      logger.warn({
        discordId,
        uuid,
        anomalyType,
        score,
        threshold,
        details
      }, 'anomaly detected');

      return db.raw.prepare('SELECT * FROM anomaly_scores WHERE id = ?').get(id);
    },

    async detectChatAnomaly(discordId, uuid, messageHistory) {
      const score = this.calculateChatAnomalyScore(messageHistory);
      if (score > 0) {
        return this.detectAnomaly(discordId, uuid, 'chat_spam', score, { messageCount: messageHistory.length });
      }
      return null;
    },

    async detectLoginAnomaly(discordId, ipHash, fingerprint) {
      const recentLogins = db.raw.prepare('SELECT * FROM user_sessions WHERE discord_id = ? AND valid = 1 ORDER BY last_used_at DESC LIMIT 10')
        .all(discordId);

      if (recentLogins.length === 0) return null;

      const ipChanges = recentLogins.filter(s => s.ip_hash !== ipHash).length;
      const deviceChanges = recentLogins.filter(s => s.device_fingerprint !== fingerprint).length;

      const score = (ipChanges * 0.5) + (deviceChanges * 0.8);

      if (score > 2.0) {
        return this.detectAnomaly(discordId, null, 'suspicious_login', score, {
          ipChanges,
          deviceChanges,
          recentLogins: recentLogins.length
        });
      }

      return null;
    },

    async detectPlaytimeAnomaly(uuid, currentPlaytime, historicalData) {
      if (!historicalData || historicalData.length < 7) return null;

      const avgPlaytime = historicalData.reduce((a, b) => a + b, 0) / historicalData.length;
      const stdDev = Math.sqrt(historicalData.reduce((a, b) => a + Math.pow(b - avgPlaytime, 2), 0) / historicalData.length);
      const zScore = (currentPlaytime - avgPlaytime) / (stdDev || 1);

      if (Math.abs(zScore) > 3.0) {
        return this.detectAnomaly(null, uuid, 'playtime_spike', Math.abs(zScore), {
          currentPlaytime,
          avgPlaytime,
          zScore
        });
      }

      return null;
    },

    calculateChatAnomalyScore(messages) {
      if (messages.length < 5) return 0;

      const timeSpan = messages[messages.length - 1].timestamp - messages[0].timestamp;
      const messagesPerSecond = messages.length / (timeSpan / 1000);

      let score = 0;

      if (messagesPerSecond > 2) score += 2;
      if (messagesPerSecond > 5) score += 3;

      const duplicateCount = this.countDuplicates(messages);
      if (duplicateCount > messages.length * 0.5) score += 2;

      const avgLength = messages.reduce((a, m) => a + m.content.length, 0) / messages.length;
      if (avgLength < 10) score += 1;

      return score;
    },

    countDuplicates(messages) {
      const seen = new Set();
      let duplicates = 0;

      for (const msg of messages) {
        const normalized = msg.content.toLowerCase().trim();
        if (seen.has(normalized)) {
          duplicates++;
        } else {
          seen.add(normalized);
        }
      }

      return duplicates;
    },

    async getAnomalies(discordId, limit = 20) {
      return db.raw.prepare('SELECT * FROM anomaly_scores WHERE discord_id = ? ORDER BY detected_at DESC LIMIT ?')
        .all(discordId, limit);
    },

    async getUnresolvedAnomalies(limit = 50) {
      return db.raw.prepare('SELECT * FROM anomaly_scores WHERE resolved = 0 ORDER BY detected_at DESC LIMIT ?')
        .all(limit);
    },

    async resolveAnomaly(anomalyId) {
      db.raw.prepare('UPDATE anomaly_scores SET resolved = 1 WHERE id = ?').run(anomalyId);
    },

    async getAnomalyStats() {
      const total = db.raw.prepare('SELECT COUNT(*) AS c FROM anomaly_scores').get().c;
      const unresolved = db.raw.prepare('SELECT COUNT(*) AS c FROM anomaly_scores WHERE resolved = 0').get().c;
      const byType = db.raw.prepare('SELECT anomaly_type, COUNT(*) AS c FROM anomaly_scores GROUP BY anomaly_type').all();

      return { total, unresolved, byType };
    }
  };
}

module.exports = { createAnomalyDetectionService };
