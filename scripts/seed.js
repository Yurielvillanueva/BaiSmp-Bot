require('dotenv').config();
const { migrate } = require('../src/db/migrate');
const { createDb } = require('../src/db');
const { seedConfigFromEnv } = require('../src/config/store');
const { encrypt } = require('../src/util/crypto');
const { loadEnv } = require('../src/config/env');

const env = loadEnv();
migrate(env.DATABASE_PATH);
const db = createDb(env.DATABASE_PATH);
seedConfigFromEnv(db, env);
db.servers.upsert({
  name: env.MC_SERVER_NAME,
  host: env.MC_HOST,
  query_port: env.MC_QUERY_PORT,
  rcon_port: env.MC_RCON_PORT,
  rcon_password_enc: env.MC_RCON_PASSWORD ? encrypt(env.MC_RCON_PASSWORD, env.CREDENTIALS_KEY) : null,
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
db.raw.prepare(`INSERT INTO scheduled_jobs (kind, cron_expr, payload, enabled)
  SELECT 'announce', '0 18 * * *', '{"message":"Daily reminder: vote and have fun!","server":"${env.MC_SERVER_NAME}"}', 1
  WHERE NOT EXISTS (SELECT 1 FROM scheduled_jobs WHERE kind = 'announce')`).run();
console.log('Seed complete');
