const crypto = require('crypto');
const { logger } = require('../logger');

function createHardwareFingerprintService(db) {
  return {
    async record(discordId, minecraftUuid, fingerprint) {
      const now = Date.now();
      const existing = db.raw.prepare('SELECT * FROM hardware_fingerprints WHERE fingerprint = ? AND minecraft_uuid = ?')
        .get(fingerprint, minecraftUuid);

      if (existing) {
        db.raw.prepare('UPDATE hardware_fingerprints SET last_seen = ?, discord_id = ? WHERE id = ?')
          .run(now, discordId, existing.id);
        return existing;
      }

      const id = db.raw.prepare(`INSERT INTO hardware_fingerprints (discord_id, minecraft_uuid, fingerprint, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?)`).run(discordId, minecraftUuid, fingerprint, now, now).lastInsertRowid;

      const checkAlt = db.raw.prepare('SELECT * FROM hardware_fingerprints WHERE fingerprint = ? AND minecraft_uuid != ?')
        .get(fingerprint, minecraftUuid);

      if (checkAlt) {
        this.flagAltAccount(discordId, minecraftUuid, checkAlt);
      }

      return db.raw.prepare('SELECT * FROM hardware_fingerprints WHERE id = ?').get(id);
    },

    async flagAltAccount(discordId, uuid, altRecord) {
      const isBanned = db.raw.prepare("SELECT 1 FROM punishments WHERE target_uuid = ? AND type IN ('ban','tempban') AND active = 1")
        .get(altRecord.minecraft_uuid);

      if (isBanned) {
        db.raw.prepare('UPDATE hardware_fingerprints SET is_banned = 1 WHERE id = ?').run(altRecord.id);
        db.raw.prepare('UPDATE hardware_fingerprints SET is_banned = 1 WHERE minecraft_uuid = ?').run(uuid);

        logger.warn({
          discordId,
          uuid,
          altUuid: altRecord.minecraft_uuid,
          altDiscord: altRecord.discord_id
        }, 'ban evasion detected via hardware fingerprint');
      }
    },

    async getFingerprints(discordId) {
      return db.raw.prepare('SELECT * FROM hardware_fingerprints WHERE discord_id = ?').all(discordId);
    },

    async getFingerprintsByUuid(uuid) {
      return db.raw.prepare('SELECT * FROM hardware_fingerprints WHERE minecraft_uuid = ?').all(uuid);
    },

    async banFingerprint(fingerprint) {
      db.raw.prepare('UPDATE hardware_fingerprints SET is_banned = 1 WHERE fingerprint = ?').run(fingerprint);
    },

    async unbanFingerprint(fingerprint) {
      db.raw.prepare('UPDATE hardware_fingerprints SET is_banned = 1 WHERE fingerprint = ?').run(fingerprint);
    },

    async isBanned(fingerprint) {
      const row = db.raw.prepare('SELECT is_banned FROM hardware_fingerprints WHERE fingerprint = ?').get(fingerprint);
      return row?.is_banned === 1;
    },

    async getAltAccounts(discordId) {
      const fingerprints = await this.getFingerprints(discordId);
      const alts = new Set();

      for (const fp of fingerprints) {
        const matches = db.raw.prepare('SELECT * FROM hardware_fingerprints WHERE fingerprint = ? AND discord_id != ?')
          .all(fp.fingerprint, discordId);
        for (const match of matches) {
          alts.add(match.discord_id);
          alts.add(match.minecraft_uuid);
        }
      }

      return Array.from(alts);
    }
  };
}

module.exports = { createHardwareFingerprintService };
