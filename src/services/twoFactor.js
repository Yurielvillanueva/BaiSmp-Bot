const speakeasy = require('speakeasy');
const { cfg } = require('../config/store');
const { logger } = require('../logger');

function createTwoFactorService(db) {
  return {
    async generateSecret(discordId) {
      const secret = speakeasy.generateSecret({
        name: cfg(db, 'staff_2fa_issuer') || 'MCBridge',
        issuer: cfg(db, 'staff_2fa_issuer') || 'MCBridge',
        length: 32
      });

      db.raw.prepare(`INSERT INTO two_factor_secrets (discord_id, secret, enabled, created_at)
        VALUES (?, ?, 0, datetime('now'))
        ON CONFLICT(discord_id) DO UPDATE SET secret = excluded.secret, enabled = 0`).run(discordId, secret.base32);

      return {
        secret: secret.base32,
        qrCode: secret.otpauth_url,
        backupCodes: this.generateBackupCodes()
      };
    },

    async enable2FA(discordId, token) {
      const row = db.raw.prepare('SELECT * FROM two_factor_secrets WHERE discord_id = ?').get(discordId);
      if (!row) throw new Error('NO_SECRET');

      const verified = speakeasy.totp.verify({
        secret: row.secret,
        encoding: 'base32',
        token,
        window: 2
      });

      if (!verified) throw new Error('INVALID_TOKEN');

      db.raw.prepare('UPDATE two_factor_secrets SET enabled = 1 WHERE discord_id = ?').run(discordId);
      return true;
    },

    async disable2FA(discordId, token) {
      const row = db.raw.prepare('SELECT * FROM two_factor_secrets WHERE discord_id = ?').get(discordId);
      if (!row) throw new Error('NO_SECRET');

      const verified = speakeasy.totp.verify({
        secret: row.secret,
        encoding: 'base32',
        token,
        window: 2
      });

      if (!verified) throw new Error('INVALID_TOKEN');

      db.raw.prepare('DELETE FROM two_factor_secrets WHERE discord_id = ?').run(discordId);
      return true;
    },

    async verify(discordId, token) {
      if (!cfg(db, 'staff_2fa_enabled')) return true;

      const row = db.raw.prepare('SELECT * FROM two_factor_secrets WHERE discord_id = ? AND enabled = 1').get(discordId);
      if (!row) return false;

      const verified = speakeasy.totp.verify({
        secret: row.secret,
        encoding: 'base32',
        token,
        window: 2
      });

      return verified;
    },

    async isEnabled(discordId) {
      const row = db.raw.prepare('SELECT enabled FROM two_factor_secrets WHERE discord_id = ?').get(discordId);
      return row?.enabled === 1;
    },

    async require2FA(discordId) {
      const enabled = cfg(db, 'staff_2fa_enabled');
      const has2FA = await this.isEnabled(discordId);
      return enabled && !has2FA;
    },

    generateBackupCodes() {
      const codes = [];
      for (let i = 0; i < 10; i++) {
        codes.push(speakeasy.generateSecret({ length: 20 }).base32.slice(0, 8).toUpperCase());
      }
      return codes;
    },

    async useBackupCode(discordId, code) {
      const row = db.raw.prepare('SELECT backup_codes FROM two_factor_secrets WHERE discord_id = ?').get(discordId);
      if (!row) throw new Error('NO_SECRET');

      const codes = JSON.parse(row.backup_codes || '[]');
      const index = codes.indexOf(code.toUpperCase());

      if (index === -1) throw new Error('INVALID_BACKUP_CODE');

      codes.splice(index, 1);
      db.raw.prepare('UPDATE two_factor_secrets SET backup_codes = ? WHERE discord_id = ?')
        .run(JSON.stringify(codes), discordId);

      return true;
    },

    async setBackupCodes(discordId, codes) {
      db.raw.prepare('UPDATE two_factor_secrets SET backup_codes = ? WHERE discord_id = ?')
        .run(JSON.stringify(codes), discordId);
    }
  };
}

module.exports = { createTwoFactorService };
