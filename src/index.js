const { loadEnv } = require('./config/env');
const { migrate, closeDb } = require('./db/migrate');
const { createDb } = require('./db');
const { seedConfigFromEnv } = require('./config/store');
const { encrypt } = require('./util/crypto');
const { logger } = require('./logger');
const { installProcessHandlers } = require('./util/errors');
const { createClient, attachBot } = require('./bot');
const { createStaffLog } = require('./services/staffLog');
const { createLinkService } = require('./services/linking');
const { createWhitelistService } = require('./services/whitelist');
const { createTicketService } = require('./services/tickets');
const { createModerationService } = require('./services/moderation');
const { createRewardsService } = require('./services/rewards');
const { createStatsService } = require('./services/stats');
const { createBackupService } = require('./services/backups');
const { createPerfService } = require('./services/perf');
const { createRankSync } = require('./services/ranks');
const { createChatBridge } = require('./services/chatBridge');
const { createAppealsService } = require('./services/appeals');
const { createEventsService } = require('./services/events');
const { createStatusService } = require('./services/status');
const { createLogTail } = require('./services/logTail');
const { createHttpServer, createPluginWebhookServer } = require('./http/server');
const { startScheduler } = require('./jobs/scheduler');
const { disconnectAll } = require('./services/rcon');
const { createRedisClient, createCacheService } = require('./services/cache');

async function main() {
  const env = loadEnv();
  migrate(env.DATABASE_PATH);
  const db = createDb(env.DATABASE_PATH);
  seedConfigFromEnv(db, env);

  const rconEnc = env.MC_RCON_PASSWORD ? encrypt(env.MC_RCON_PASSWORD, env.CREDENTIALS_KEY) : null;
  db.servers.upsert({
    name: env.MC_SERVER_NAME,
    host: env.MC_HOST,
    rcon_host: env.MC_RCON_HOST || env.MC_HOST,
    query_port: env.MC_QUERY_PORT,
    rcon_port: env.MC_RCON_PORT,
    rcon_password_enc: rconEnc,
    plugin_api_url: env.PLUGIN_API_URL,
    world_path: env.MC_WORLD_PATH || null,
    log_path: env.MC_LOG_PATH || null,
    backup_path: env.MC_BACKUP_PATH,
    status_channel_id: process.env.STATUS_CHANNEL_ID || null,
    console_channel_id: process.env.CONSOLE_CHANNEL_ID || null,
    chat_channel_id: process.env.CHAT_BRIDGE_CHANNEL_ID || null,
    alert_channel_id: process.env.ALERT_DEFAULT_CHANNEL_ID || null,
    enabled: 1
  });

  const cache = createCacheService(createRedisClient(env));
  const client = createClient();
  const ctx = { env, db, client, cache };
  ctx.staffLog = createStaffLog(db);
  ctx.links = createLinkService(db);
  ctx.whitelist = createWhitelistService(ctx);
  ctx.moderation = createModerationService(ctx);
  ctx.rewards = createRewardsService(ctx);
  ctx.stats = createStatsService(ctx);
  ctx.backups = createBackupService(ctx);
  ctx.perf = createPerfService(ctx);
  ctx.ranks = createRankSync(ctx);
  ctx.chatBridge = createChatBridge(ctx);
  ctx.appeals = createAppealsService(ctx);
  ctx.events = createEventsService(ctx);
  ctx.tickets = createTicketService(ctx);
  ctx.status = createStatusService(ctx);
  installProcessHandlers(env, () => ctx);

  attachBot(ctx);
  const httpServer = createHttpServer(ctx);
  const pluginWebhookServer = createPluginWebhookServer(ctx);
  const tail = createLogTail(ctx);
  tail.start();

  await client.login(env.DISCORD_TOKEN);
  const sched = startScheduler(ctx);

  const shutdown = async (signal) => {
    logger.info({ signal }, 'shutting down');
    sched.stop();
    tail.stop();
    disconnectAll();
    await Promise.all([
      new Promise((resolve, reject) => httpServer.close((err) => err ? reject(err) : resolve())),
      new Promise((resolve, reject) => pluginWebhookServer.close((err) => err ? reject(err) : resolve()))
    ]);
    await cache.quit();
    await client.destroy();
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'startup failed');
  process.exit(1);
});
