const { logger } = require('../logger');

function createToxicityDetectionService(db) {
  const toxicPatterns = [
    /\b(kill|die|murder)\s+(yourself|you)\b/gi,
    /\b(suicid|self\s+harm)\b/gi,
    /\b(nigger|nigg|faggot|fag)\b/gi,
    /\b(cunt|whore|slut)\b/gi,
    /\b(idiot|retard|stupid)\b/gi,
    /\b(shut\s+up|stfu)\b/gi,
    /\b(dumb|moron)\b/gi
  ];

  const severityMap = {
    racial_slur: 10,
    hate_speech: 9,
    self_harm: 8,
    severe_insult: 7,
    insult: 5,
    aggressive: 4,
    mild: 2
  };

  return {
    async analyze(message, context = {}) {
      if (!context.discordId && !context.uuid) {
        return { toxic: false, score: 0, categories: [] };
      }

      const text = message.toLowerCase();
      let score = 0;
      const categories = [];
      const matches = [];

      for (const pattern of toxicPatterns) {
        const found = text.match(pattern);
        if (found) {
          const category = this.categorizePattern(pattern);
          const severity = severityMap[category] || 3;
          score += severity;
          categories.push(category);
          matches.push({ pattern: pattern.source, matches: found });
        }
      }

      const capsRatio = (message.match(/[A-Z]/g) || []).length / message.length;
      if (capsRatio > 0.7 && message.length > 10) {
        score += 2;
        categories.push('excessive_caps');
      }

      const punctuationCount = (message.match(/[!?]/g) || []).length;
      if (punctuationCount > 5) {
        score += 1;
        categories.push('excessive_punctuation');
      }

      const spamScore = this.detectSpam(message, context);
      score += spamScore.score;
      if (spamScore.category) categories.push(spamScore.category);

      const toxic = score >= 5;

      if (toxic) {
        await this.logToxicMessage(context.discordId, context.uuid, message, score, categories, matches);
      }

      return {
        toxic,
        score,
        categories,
        matches,
        confidence: Math.min(score / 10, 1)
      };
    },

    categorizePattern(pattern) {
      const str = pattern.source.toLowerCase();
      if (str.includes('nigger') || str.includes('faggot')) return 'racial_slur';
      if (str.includes('kill') || str.includes('die') || str.includes('suicid')) return 'self_harm';
      if (str.includes('cunt') || str.includes('whore')) return 'severe_insult';
      if (str.includes('shut') || str.includes('stfu')) return 'aggressive';
      return 'insult';
    },

    detectSpam(message, context) {
      let score = 0;
      let category = null;

      const repeatedChars = /(.)\1{5,}/g;
      if (repeatedChars.test(message)) {
        score += 3;
        category = 'character_spam';
      }

      const repeatedWords = /\b(\w+)\s+\1\b/gi;
      if (repeatedWords.test(message)) {
        score += 2;
        category = 'word_spam';
      }

      if (context.recentMessages && context.recentMessages.length > 5) {
        const recentText = context.recentMessages.map(m => m.content).join(' ').toLowerCase();
        const duplicateCount = (recentText.match(new RegExp(message.toLowerCase(), 'g')) || []).length;
        if (duplicateCount > 2) {
          score += 4;
          category = 'message_spam';
        }
      }

      return { score, category };
    },

    async logToxicMessage(discordId, uuid, message, score, categories, matches) {
      db.raw.prepare(`INSERT INTO toxicity_log (discord_id, minecraft_uuid, message, score, categories, matches, detected_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        discordId,
        uuid,
        message,
        score,
        JSON.stringify(categories),
        JSON.stringify(matches),
        Date.now()
      );
    },

    async getToxicityHistory(discordId, limit = 50) {
      return db.raw.prepare('SELECT * FROM toxicity_log WHERE discord_id = ? ORDER BY detected_at DESC LIMIT ?')
        .all(discordId, limit);
    },

    async getToxicityStats(discordId) {
      const stats = db.raw.prepare(`
        SELECT
          COUNT(*) as total,
          AVG(score) as avg_score,
          MAX(score) as max_score,
          COUNT(DISTINCT categories) as unique_categories
        FROM toxicity_log
        WHERE discord_id = ?
      `).get(discordId);

      const byCategory = db.raw.prepare(`
        SELECT json_each(categories.value) as category, COUNT(*) as count
        FROM toxicity_log, json_each(toxicity_log.categories)
        WHERE discord_id = ?
        GROUP BY category
        ORDER BY count DESC
      `).all(discordId);

      return { ...stats, byCategory };
    },

    async shouldAutoModerate(analysis, context) {
      if (!analysis.toxic) return false;

      const threshold = context.threshold || 8;

      if (analysis.score >= threshold) {
        return {
          action: 'delete',
          reason: `Toxic content detected (score: ${analysis.score})`
        };
      }

      if (analysis.categories.includes('racial_slur') || analysis.categories.includes('hate_speech')) {
        return {
          action: 'delete',
          reason: 'Hate speech detected'
        };
      }

      if (analysis.categories.includes('self_harm')) {
        return {
          action: 'alert',
          reason: 'Self-harm content detected'
        };
      }

      return null;
    },

    async addToxicityTable() {
      db.raw.prepare(`CREATE TABLE IF NOT EXISTS toxicity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT,
        minecraft_uuid TEXT,
        message TEXT NOT NULL,
        score REAL NOT NULL,
        categories TEXT NOT NULL,
        matches TEXT,
        detected_at INTEGER NOT NULL
      )`).run();

      db.raw.prepare('CREATE INDEX IF NOT EXISTS idx_toxicity_discord ON toxicity_log(discord_id)').run();
      db.raw.prepare('CREATE INDEX IF NOT EXISTS idx_toxicity_uuid ON toxicity_log(minecraft_uuid)').run();
      db.raw.prepare('CREATE INDEX IF NOT EXISTS idx_toxicity_score ON toxicity_log(score)').run();
    }
  };
}

module.exports = { createToxicityDetectionService };
