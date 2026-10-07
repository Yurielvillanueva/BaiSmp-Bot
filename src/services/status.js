const util = require('minecraft-server-util');
const { logger } = require('../logger');
const { cfg } = require('../config/store');
const { embed } = require('../util/embeds');
const { stripColorCodes } = require('../util/sanitize');
const { pluginGet } = require('./pluginClient');
const rcon = require('./rcon');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parsePlayerCounts(response) {
  const text = String(response || '');
  const match = text.match(/\bThere are\s+(\d+)\s+(?:of\s+a\s+max(?:imum)?\s+of|out\s+of\s+(?:the\s+)?(?:maximum|max)(?:\s+of)?)\s+(\d+)\s+players?\s+online\b/i)
    || text.match(/\b(\d+)\s*\/\s*(\d+)\s+players?\s+online\b/i);
  if (!match) return null;

  const players = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isSafeInteger(players) || !Number.isSafeInteger(max) || players > max) return null;

  const listedPlayers = text.match(/players?\s+online:\s*(.+)$/i)?.[1];
  return {
    players,
    max,
    sample: listedPlayers ? listedPlayers.split(',').map((name) => name.trim()).filter(Boolean) : []
  };
}

async function pingServer(server, ctx) {
  let ping;
  try {
    const status = await util.status(server.host, server.query_port, { timeout: 4000 });
    ping = {
      online: true,
      players: status.players?.online ?? 0,
      max: status.players?.max ?? 0,
      sample: (status.players?.sample || []).map((p) => p.name),
      version: status.version?.name || 'unknown',
      motd: stripColorCodes(status.motd?.clean || status.motd?.raw || ''),
      ping: status.roundTripLatency ?? 0
    };
  } catch {
    try {
      const q = await util.queryFull(server.host, server.query_port, { timeout: 4000 });
      ping = {
        online: true,
        players: q.players?.online ?? 0,
        max: q.players?.max ?? 0,
        sample: q.players?.list || [],
        version: q.version || 'unknown',
        motd: stripColorCodes(q.motd || ''),
        ping: 0
      };
    } catch (err) {
      logger.debug({ err: err.message, server: server.name }, 'status ping failed');
      ping = { online: false, players: 0, max: 0, sample: [], version: 'unknown', motd: '', ping: 0 };
    }
  }

  if (ctx && (!ping.online || ping.max === 0)) {
    try {
      const { result } = await rcon.sendRcon(ctx.env, ctx.db, server, 'list');
      const counts = parsePlayerCounts(result);
      if (counts) {
        return {
          ...ping,
          online: true,
          ...counts,
          version: ping.version === 'unknown' ? 'RCON' : ping.version
        };
      }
      logger.warn({ server: server.name }, 'RCON list response did not include recognizable player counts');
    } catch (err) {
      logger.warn({ err, server: server.name }, 'RCON player count fallback failed');
    }
  }

  return ping;
}

function syncMaintenance(db, server, ping) {
  if (!ping.online) return;
  const isMaintenance = /\bmaintenance\b/i.test(ping.motd || '') ? 1 : 0;
  if (Number(server.maintenance || 0) === isMaintenance) return;
  db.raw.prepare('UPDATE servers SET maintenance = ? WHERE id = ?').run(isMaintenance, server.id);
  server.maintenance = isMaintenance;
}

function getFailState(db, serverId) {
  let row = db.raw.prepare('SELECT * FROM status_state WHERE server_id = ?').get(serverId);
  if (!row) {
    db.raw.prepare('INSERT INTO status_state (server_id, fail_streak, last_rename_times) VALUES (?, 0, ?)').run(serverId, '[]');
    row = db.raw.prepare('SELECT * FROM status_state WHERE server_id = ?').get(serverId);
  }
  return row;
}

function canRename(db, serverId, maxPerWindow) {
  const row = getFailState(db, serverId);
  const times = JSON.parse(row.last_rename_times || '[]').filter((t) => Date.now() - t < 10 * 60 * 1000);
  return { ok: times.length < maxPerWindow, times };
}

async function updatePresence(client, totalOnline, totalMax) {
  await client.user.setPresence({
    activities: [{ name: `${totalOnline}/${totalMax} players`, type: 3 }],
    status: totalOnline > 0 ? 'idle' : 'invisible'
  });
}

function statusEmbed(db, server, ping, extras) {
  const maint = Boolean(Number(server.maintenance || 0));
  const color = maint ? 0xf1c40f : ping.online ? 0x2ecc71 : 0xe74c3c;
  const list = ping.sample.length ? ping.sample.slice(0, 25).join(', ') : 'No players listed';
  const fields = [
    { name: 'Players', value: `${ping.players}/${ping.max}`, inline: true },
    { name: 'Version', value: String(ping.version).slice(0, 80), inline: true },
    { name: 'Supported versions', value: '1.21–1.21.11 (latest)', inline: true },
    { name: 'Server address', value: `${server.host}:${server.query_port}`, inline: false },
    { name: 'MOTD', value: ping.motd.slice(0, 1024) || '—', inline: false },
    { name: 'Players online', value: list.slice(0, 1024), inline: false }
  ];
  if (extras) {
    fields.splice(2, 0,
      { name: 'Ping', value: `${ping.ping}ms`, inline: true },
      { name: 'TPS', value: extras.tps != null ? String(extras.tps) : 'n/a', inline: true }
    );
  }
  return embed(db, {
    title: `${server.name} — ${ping.online ? '🟢 ONLINE' : '🔴 OFFLINE'}${maint ? ' (Maintenance)' : ''}`,
    color,
    fields
  });
}

function createStatusService(ctx) {
  const { env, db, client } = ctx;

  async function tickOne(server) {
    const ping = await pingServer(server, ctx);
    syncMaintenance(db, server, ping);
    const extras = {};
    if (ping.online && server.plugin_api_url) {
      try {
        const perf = await pluginGet(env, server, '/v1/perf');
        extras.tps = perf.tps;
      } catch {
        extras.tps = null;
      }
    }
    const state = getFailState(db, server.id);
    if (!ping.online) {
      const streak = state.fail_streak + 1;
      db.raw.prepare('UPDATE status_state SET fail_streak = ? WHERE server_id = ?').run(streak, server.id);
      if (streak === cfg(db, 'crash_fail_threshold')) {
        const { dispatchAlert } = require('./alerts');
        await dispatchAlert(ctx, server, 'crash', { title: 'Possible crash', description: `${server.name} failed ${streak} consecutive status checks.` });
      }
    } else {
      if (state.fail_streak > 0 && !state.last_online) {
        const { dispatchAlert } = require('./alerts');
        await dispatchAlert(ctx, server, 'server_start', { title: 'Server online', description: `${server.name} is responding again.` });
      }
      db.raw.prepare('UPDATE status_state SET fail_streak = 0, last_online = 1 WHERE server_id = ?').run(server.id);
    }

    if (!server.status_channel_id) return ping;
    const channel = await client.channels.fetch(server.status_channel_id).catch(() => null);
    if (!channel?.isTextBased()) return ping;
    const payload = { embeds: [statusEmbed(db, server, ping, extras)] };
    if (server.status_message_id) {
      const msg = await channel.messages.fetch(server.status_message_id).catch(() => null);
      if (msg) {
        await msg.edit(payload);
      } else {
        const sent = await channel.send(payload);
        db.servers.setStatusMessage(server.id, sent.id);
      }
    } else {
      const sent = await channel.send(payload);
      db.servers.setStatusMessage(server.id, sent.id);
    }

    const { ok, times } = canRename(db, server.id, Number(process.env.CHANNEL_RENAME_MAX_PER_10M || 2));
    if (ok && ping.online) {
      const name = `${server.name}-${ping.players}`.slice(0, 90).replace(/[^a-zA-Z0-9-_]/g, '-');
      if (channel.name !== name) {
        await channel.setName(name).catch(() => {});
        times.push(Date.now());
        db.raw.prepare('UPDATE status_state SET last_rename_times = ? WHERE server_id = ?').run(JSON.stringify(times), server.id);
      }
    }
    return ping;
  }

  async function publish(server, ping, channel) {
    if (!channel?.isTextBased() || typeof channel.send !== 'function') {
      throw new Error('STATUS_CHANNEL_UNAVAILABLE');
    }

    syncMaintenance(db, server, ping);
    const payload = { embeds: [statusEmbed(db, server, ping)] };
    if (server.status_message_id && server.status_channel_id === channel.id) {
      const existing = await channel.messages.fetch(server.status_message_id).catch(() => null);
      if (existing) {
        await existing.edit(payload);
        return existing;
      }
    }

    const message = await channel.send(payload);
    db.servers.setStatusChannel(server.id, channel.id);
    db.servers.setStatusMessage(server.id, message.id);
    server.status_channel_id = channel.id;
    server.status_message_id = message.id;
    return message;
  }

  async function tick() {
    const servers = db.servers.all();
    let online = 0;
    let max = 0;
    for (const server of servers) {
      try {
        const ping = await tickOne(server);
        if (ping?.online) {
          online += ping.players;
          max += ping.max;
        }
      } catch (err) {
        logger.error({ err, server: server.name }, 'status tick failed');
      }
    }
    await updatePresence(client, online, max).catch(() => {});
  }

  return { tick, pingServer, publish, sleep };
}

module.exports = { createStatusService, pingServer, parsePlayerCounts, statusEmbed };