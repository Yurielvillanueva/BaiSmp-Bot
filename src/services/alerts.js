const { cfg } = require('../config/store');
const { embed } = require('../util/embeds');
const { logger } = require('../logger');

const EVENT_TYPES = [
  'join', 'leave', 'first_join', 'death', 'advancement',
  'server_start', 'server_stop', 'crash', 'tps', 'ban', 'whitelist'
];

function alertChannel(db, server, eventType) {
  const row = db.raw.prepare('SELECT * FROM alerts_config WHERE server_id = ? AND event_type = ?').get(server.id, eventType);
  if (row && !row.enabled) return null;
  return row?.channel_id || server.alert_channel_id || process.env.ALERT_DEFAULT_CHANNEL_ID;
}

async function dispatchAlert(ctx, server, eventType, payload) {
  const { db, client } = ctx;
  const channelId = alertChannel(db, server, eventType);
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const e = embed(db, {
    title: payload.title || eventType,
    description: payload.description || '',
    fields: payload.fields
  });
  await channel.send({ embeds: [e] }).catch((err) => logger.warn({ err: err.message }, 'alert send failed'));
}

function setAlert(db, serverId, eventType, enabled, channelId) {
  db.raw.prepare(`INSERT INTO alerts_config (server_id, event_type, enabled, channel_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(server_id, event_type) DO UPDATE SET enabled = excluded.enabled, channel_id = excluded.channel_id`)
    .run(serverId, eventType, enabled ? 1 : 0, channelId || null);
}

function listAlerts(db, serverId) {
  return EVENT_TYPES.map((event_type) => {
    const row = db.raw.prepare('SELECT * FROM alerts_config WHERE server_id = ? AND event_type = ?').get(serverId, event_type);
    return row || { event_type, enabled: 1, channel_id: null };
  });
}

async function handlePluginEvent(ctx, body) {
  const server = ctx.db.servers.getByName(body.server) || ctx.db.servers.all()[0];
  if (!server) return;
  const map = {
    join: { title: 'Player join', description: `${body.username} joined.` },
    leave: { title: 'Player leave', description: `${body.username} left.` },
    first_join: { title: 'First join', description: `${body.username} joined for the first time.` },
    death: { title: 'Death', description: body.message || `${body.username} died.` },
    advancement: { title: 'Advancement', description: `${body.username} got ${body.advancement}` },
    server_start: { title: 'Server started', description: server.name },
    server_stop: { title: 'Server stopped', description: server.name },
    tps: { title: 'Low TPS', description: `TPS ${body.tps} (threshold ${cfg(ctx.db, 'tps_alert_threshold')})` },
    ban: { title: 'Ban', description: `${body.username} banned: ${body.reason || 'no reason'}` },
    whitelist: { title: 'Whitelist change', description: body.message || JSON.stringify(body) }
  };
  const payload = map[body.type];
  if (payload) await dispatchAlert(ctx, server, body.type, payload);
  if (body.type === 'join' && body.hashedIp) {
    const { noteIpHash } = require('./antiAbuse');
    await noteIpHash(ctx, body);
  }
}

module.exports = { EVENT_TYPES, dispatchAlert, setAlert, listAlerts, handlePluginEvent };
