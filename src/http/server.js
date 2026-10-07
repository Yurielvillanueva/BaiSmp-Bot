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

async function handlePluginWebhook(req, res, ctx) {
  const { env, db } = ctx;
  const { wrapPluginWebhook } = require('../services/pluginClient');
  const handler = wrapPluginWebhook(env, db, async (body, _req, response) => {
    await require('../services/alerts').handlePluginEvent(ctx, body);
    if (body.type === 'chat') {
      const server = db.servers.getByName(body.server) || db.servers.all()[0];
      if (server) await ctx.chatBridge.fromMinecraft(ctx.client, server, body.username, body.message);
    }
    if (body.type === 'lp_sync') {
      const guild = await ctx.client.guilds.fetch(env.DISCORD_GUILD_ID);
      await ctx.ranks.lpToDiscord(guild, body.uuid, body.groups || []);
    }
    if (body.type === 'link_code' && body.code && body.uuid && body.username) {
      ctx.links.storeCode(body.code, body.uuid, body.username);
    }
    if (body.type === 'discordsrv_linked' && body.discordId && body.uuid && body.username) {
      ctx.links.link({ discordId: body.discordId, uuid: body.uuid, username: body.username });
    }
    if (body.type === 'discordsrv_unlinked' && body.discordId && body.uuid) {
      ctx.links.unlinkMinecraft({ discordId: body.discordId, uuid: body.uuid });
    }
    response.writeHead(204);
    response.end();
  });
  await handler(req, res);
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
      await handlePluginWebhook(req, res, ctx);
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

function createPluginWebhookServer(ctx) {
  const { env } = ctx;
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/plugin/event') {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    handlePluginWebhook(req, res, ctx).catch((err) => {
      logger.error({ err }, 'plugin webhook listener failed');
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('error');
      }
    });
  });
  server.listen(env.PLUGIN_WEBHOOK_PORT, '127.0.0.1', () => {
    logger.info({ port: env.PLUGIN_WEBHOOK_PORT }, 'plugin webhook tunnel listener listening');
  });
  return server;
}

function diagnosticFailure(err) {
  const reason = err?.cause?.code || err?.code || err?.name || 'unknown error';
  const guidance = {
    ECONNREFUSED: 'Connection refused; confirm the service is listening on a bot-reachable host and port, and the host firewall allows this bot.',
    ETIMEDOUT: 'Connection timed out; check the host, port, routing, and firewall.',
    ENOTFOUND: 'Hostname did not resolve; check the configured address and DNS.',
    AbortError: 'Request timed out; check whether the service is running and reachable.'
  }[reason];
  return `${guidance || 'Request failed'} (${String(reason).slice(0, 80)})`;
}

function isLoopbackHost(host) {
  const normalized = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '::1' || normalized.startsWith('127.');
}

function pluginApiLoopbackMisconfiguration(server) {
  try {
    const pluginHost = new URL(server.plugin_api_url).hostname;
    return isLoopbackHost(pluginHost) && !isLoopbackHost(server.host);
  } catch {
    return false;
  }
}

async function diagnostics(ctx, selectedServer) {
  const server = selectedServer || ctx.db.servers.all()[0];
  const checks = [
    {
      name: 'Discord',
      ok: Boolean(ctx.client?.isReady?.() || ctx.client?.ws?.status === 0),
      detail: ctx.client?.isReady?.() || ctx.client?.ws?.status === 0 ? 'Bot is connected.' : 'Bot client is not ready.'
    }
  ];
  try {
    ctx.db.raw.prepare('SELECT 1').get();
    checks.push({ name: 'Database', ok: true, detail: 'SQLite query succeeded.' });
  } catch (err) {
    checks.push({ name: 'Database', ok: false, detail: diagnosticFailure(err) });
  }
  if (server) {
    try {
      const { sendRcon } = require('../services/rcon');
      await sendRcon(ctx.env, ctx.db, server, 'list');
      checks.push({ name: 'RCON', ok: true, detail: `Connected to ${server.rcon_host || server.host}:${server.rcon_port}.` });
    } catch (err) {
      const code = err?.cause?.code || err?.code;
      const detail = code === 'ECONNREFUSED'
        ? `Connection refused at ${server.rcon_host || server.host}:${server.rcon_port}. Minecraft query is separate; ask your host for the external RCON address/port and set MC_RCON_HOST and MC_RCON_PORT to those allocated values.`
        : `${server.rcon_host || server.host}:${server.rcon_port} — ${diagnosticFailure(err)}`;
      checks.push({ name: 'RCON', ok: false, detail });
    }
    if (server.plugin_api_url) {
      if (pluginApiLoopbackMisconfiguration(server)) {
        checks.push({
          name: 'Plugin API',
          ok: false,
          detail: 'Configured URL uses 127.0.0.1/localhost, which points to the bot PC, not this remote Minecraft server. Ask your host for a private or HTTPS plugin endpoint and set PLUGIN_API_URL to it; do not expose the plugin port publicly.'
        });
      } else {
        try {
          await pluginGet(ctx.env, server, '/v1/health');
          checks.push({ name: 'Plugin API', ok: true, detail: 'Health endpoint responded.' });
        } catch (err) {
          checks.push({ name: 'Plugin API', ok: false, detail: diagnosticFailure(err) });
        }
      }
    } else {
      checks.push({ name: 'Plugin API', ok: false, detail: 'No plugin API URL is configured for this server.' });
    }
    const ping = await pingServer(server, ctx);
    checks.push({
      name: 'Minecraft query',
      ok: ping.online,
      detail: ping.online
        ? `${server.host}:${server.query_port} responded; ${ping.players}/${ping.max} players.`
        : `No status/query response from ${server.host}:${server.query_port}.`
    });
  } else {
    checks.push({ name: 'Minecraft server', ok: false, detail: 'No enabled server is configured.' });
  }
  return checks;
}

module.exports = {
  createHttpServer,
  createPluginWebhookServer,
  diagnostics,
  diagnosticFailure,
  pluginApiLoopbackMisconfiguration,
  inc,
  metrics
};
