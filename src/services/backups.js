const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { sendRcon } = require('./rcon');
const { cfg } = require('../config/store');
const { logger } = require('../logger');

function encryptFile(src, dest, secret) {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash('sha256').update(secret).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = fs.readFileSync(src);
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  fs.writeFileSync(dest, Buffer.concat([iv, tag, enc]));
}

function createBackupService(ctx) {
  const { db, env } = ctx;

  async function archiveWorld(worldPath, outTar) {
    await new Promise((resolve, reject) => {
      const tar = spawn('tar', ['-czf', outTar, '-C', path.dirname(worldPath), path.basename(worldPath)], { windowsHide: true });
      tar.on('error', () => {
        const zip = spawn(process.platform === 'win32' ? 'powershell' : 'zip', process.platform === 'win32'
          ? ['-NoProfile', '-Command', `Compress-Archive -Path '${worldPath}' -DestinationPath '${outTar}.zip' -Force`]
          : ['-r', `${outTar}.zip`, worldPath], { windowsHide: true });
        zip.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('archive failed'))));
        zip.on('error', reject);
      });
      tar.on('exit', (c) => {
        if (c === 0) resolve();
        else reject(new Error('tar failed'));
      });
    });
  }

  return {
    async run(server, actorId) {
      const world = server.world_path || env.MC_WORLD_PATH;
      if (!world) throw new Error('NO_WORLD_PATH');
      const dir = path.resolve(server.backup_path || env.MC_BACKUP_PATH);
      fs.mkdirSync(dir, { recursive: true });
      await sendRcon(env, db, server, 'save-off');
      try {
        await sendRcon(env, db, server, 'save-all');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const tmp = path.join(dir, `world-${stamp}.tgz`);
        await archiveWorld(world, tmp);
        const finalPath = `${tmp}.enc`;
        const src = fs.existsSync(tmp) ? tmp : `${tmp}.zip`;
        encryptFile(src, finalPath, env.BACKUP_ENCRYPTION_KEY);
        fs.unlinkSync(src);
        const bytes = fs.statSync(finalPath).size;
        db.raw.prepare('INSERT INTO backups (server_id, path, created_at, bytes) VALUES (?, ?, ?, ?)').run(server.id, finalPath, Date.now(), bytes);
        ctx.staffLog.add({ actorId: actorId || 'system', action: 'backup', result: finalPath, reason: server.name, targetName: server.name });
        this.prune(server);
        return finalPath;
      } finally {
        await sendRcon(env, db, server, 'save-on').catch((err) => logger.warn({ err: err.message }, 'save-on failed'));
      }
    },
    prune(server) {
      const keep = cfg(db, 'backup_keep_last');
      const rows = db.raw.prepare('SELECT * FROM backups WHERE server_id = ? ORDER BY created_at DESC').all(server.id);
      for (const row of rows.slice(keep)) {
        try { fs.unlinkSync(row.path); } catch { /* ignore */ }
        db.raw.prepare('DELETE FROM backups WHERE id = ?').run(row.id);
      }
    },
    list(server) {
      return db.raw.prepare('SELECT * FROM backups WHERE server_id = ? ORDER BY created_at DESC').all(server.id);
    }
  };
}

module.exports = { createBackupService };
