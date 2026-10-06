const { Rcon } = require('rcon-client');
const { logger } = require('../logger');
const { decrypt } = require('../util/crypto');
const { sanitizeRconCommand } = require('../util/sanitize');
const { cfg } = require('../config/store');
const { memberTier } = require('../util/staff');

const clients = new Map();

function commandBase(cmd) {
  return cmd.trim().split(/\s+/)[0].toLowerCase();
}

function allowedForTier(db, tier, cmd) {
  const blocked = cfg(db, 'rcon_blocked') || [];
  const base = commandBase(cmd);
  if (blocked.includes(base) || blocked.includes(cmd.toLowerCase())) return { ok: false, reason: 'blocked' };
  const lists = cfg(db, 'rcon_allowlists') || {};
  const list = lists[tier] || [];
  if (list.includes('*')) return { ok: true };
  const ok = list.some((entry) => cmd.toLowerCase() === entry.toLowerCase() || cmd.toLowerCase().startsWith(`${entry.toLowerCase()} `) || base === entry.toLowerCase());
  return { ok, reason: ok ? null : 'denied' };
}

function needsConfirm(db, cmd) {
  const list = cfg(db, 'rcon_confirm') || [];
  const base = commandBase(cmd);
  return list.includes(base) || list.includes(cmd.toLowerCase());
}

async function getClient(env, server) {
  const key = server.id;
  const existing = clients.get(key);
  if (existing?.authed) return existing;
  const password = server.rcon_password_enc
    ? decrypt(server.rcon_password_enc, env.CREDENTIALS_KEY)
    : env.MC_RCON_PASSWORD;
  const rcon = await Rcon.connect({
    host: server.host,
    port: server.rcon_port,
    password,
    timeout: env.RCON_TIMEOUT_MS
  });
  clients.set(key, rcon);
  rcon.on('end', () => clients.delete(key));
  rcon.on('error', () => {
    clients.delete(key);
    try { rcon.end(); } catch { /* ignore */ }
  });
  return rcon;
}

async function sendRcon(env, db, server, rawCommand) {
  if (cfg(db, 'rcon_kill_switch')) {
    throw new Error('RCON_KILL_SWITCH');
  }
  const command = sanitizeRconCommand(rawCommand);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const client = await getClient(env, server);
      const result = await Promise.race([
        client.send(command),
        new Promise((_, rej) => setTimeout(() => rej(new Error('RCON_TIMEOUT')), env.RCON_TIMEOUT_MS))
      ]);
      return { command, result: String(result || '').slice(0, 1800) };
    } catch (err) {
      lastErr = err;
      clients.delete(server.id);
      logger.warn({ err: err.message, attempt, server: server.name }, 'rcon retry');
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  throw lastErr;
}

function assertStaffCommand(db, member, rawCommand) {
  const command = sanitizeRconCommand(rawCommand);
  const tier = memberTier(member, db);
  if (!tier) return { ok: false, reason: 'denied', command };
  const allow = allowedForTier(db, tier, command);
  return { ...allow, command, confirm: needsConfirm(db, command) };
}

function disconnectAll() {
  for (const client of clients.values()) {
    try { client.end(); } catch { /* ignore */ }
  }
  clients.clear();
}

module.exports = {
  sendRcon,
  assertStaffCommand,
  allowedForTier,
  needsConfirm,
  disconnectAll,
  commandBase
};
