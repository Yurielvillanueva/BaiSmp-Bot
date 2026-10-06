const http = require('http');
const { logger, requestId } = require('../logger');
const { pingServer } = require('../services/status');
const { pluginGet } = require('../services/pluginClient');

const metrics = {
  commands: 0,
  rcon: 0,
  errors: 0
};

function inc(name) {
  metrics[name] = (metrics[name] || 0) + 1;
}

function prometheus() {
  return [
    `# HELP mcbridge_commands_total Slash commands handled`,
    `# TYPE mcbridge_commands_total counter`,
    `mcbridge_commands_total ${metrics.commands}`,
    `# HELP mcbridge_errors_total Errors`,
    `# TYPE mcbridge_errors_total counter`,
    `mcbridge_errors_total ${metrics.errors}`,
    `# HELP mcbridge_rcon_total RCON calls`,
    `# TYPE mcbridge_rcon_total counter`,
    `mcbridge_rcon_total ${metrics.rcon}`
  ].join('\n');
}

function createHttpServer(ctx) {
  const { env, db } = ctx;
  const server = http.createServer(async (req, res) => {
    const rid = requestId();
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rid, uptime: process.uptime() }));
      return;
    }
    if (req.url === '/metrics') {
      if (env.PROM_METRICS_TOKEN && req.headers.authorization !== `Bearer ${env.PROM_METRICS_TOKEN}`) {
        res.writeHead(401);
        res.end('unauthorized');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(prometheus());
      return;
    }
    if (req.method === 'POST' && req.url === '/plugin/event') {
      const { wrapPluginWebhook } = require('../services/pluginClient');
      const handler = wrapPluginWebhook(env, db, async (body, _req, r) => {
        await require('./alerts').handlePluginEvent(ctx, body);
        if (body.type === 'chat') {
          const srv = db.servers.getByName(body.server) || db.servers.all()[0];
          if (srv) await ctx.chatBridge.fromMinecraft(ctx.client, srv, body.username, body.message);
        }
        if (body.type === 'lp_sync') {
          const guild = await ctx.client.guilds.fetch(env.DISCORD_GUILD_ID);
          await ctx.ranks.lpToDiscord(guild, body.uuid, body.groups || []);
        }
        if (body.type === 'link_code' && body.code && body.uuid && body.username) {
          ctx.links.storeCode(body.code, body.uuid, body.username);
        }
        r.writeHead(204);
        r.end();
      });
      await handler(req, res);
      return;
    }
    if (req.method === 'POST' && req.url === '/votifier') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      ctx.rewards.recordVote({ username: body.username, uuid: body.uuid, service: body.service });
      await ctx.rewards.rewardVote(body.username);
      const chId = db.config.get('vote_channel_id');
      if (chId) {
        const ch = await ctx.client.channels.fetch(chId).catch(() => null);
        if (ch) await ch.send({ content: `Vote from **${body.username}** via ${body.service || 'Votifier'}` });
      }
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  server.listen(env.BOT_HTTP_PORT, '127.0.0.1', () => {
    logger.info({ port: env.BOT_HTTP_PORT }, 'http listening');
  });
  return server;
}

async function diagnostics(ctx) {
  const server = ctx.db.servers.all()[0];
  const checks = {
    discord: Boolean(ctx.client?.isReady?.() || ctx.client?.ws?.status === 0),
    database: false,
    rcon: false,
    plugin: false,
    ping: false
  };
  try {
    ctx.db.raw.prepare('SELECT 1').get();
    checks.database = true;
  } catch { /* ignore */ }
  if (server) {
    try {
      const { sendRcon } = require('./rcon');
      await sendRcon(ctx.env, ctx.db, server, 'list');
      checks.rcon = true;
    } catch { /* ignore */ }
    try {
      await pluginGet(ctx.env, server, '/v1/health');
      checks.plugin = true;
    } catch { /* ignore */ }
    const ping = await pingServer(server);
    checks.ping = ping.online;
  }
  return checks;
}

module.exports = { createHttpServer, diagnostics, inc, metrics };
