const path = require('path');
const { z } = require('zod');

require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const schema = z.object({
  NODE_ENV: z.string().default('production'),
  LOG_LEVEL: z.string().default('info'),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  DATABASE_PATH: z.string().default('./data/bridge.sqlite'),
  CREDENTIALS_KEY: z.string().min(16),
  BACKUP_ENCRYPTION_KEY: z.string().min(16),
  HMAC_SHARED_SECRET: z.string().min(16),
  RCON_TIMEOUT_MS: z.coerce.number().default(5000),
  PLUGIN_API_TIMEOUT_MS: z.coerce.number().default(4000),
  STATUS_INTERVAL_MS: z.coerce.number().default(30000),
  LOG_TAIL_BATCH_MS: z.coerce.number().default(2000),
  PERF_INTERVAL_MS: z.coerce.number().default(60000),
  BOT_HTTP_PORT: z.coerce.number().default(3000),
  ERROR_CHANNEL_ID: z.string().optional().default(''),
  ERROR_NOTIFY_ROLE_ID: z.string().optional().default(''),
  ERROR_WEBHOOK_URL: z.string().optional().default(''),
  PROM_METRICS_TOKEN: z.string().optional().default(''),
  MC_SERVER_NAME: z.string().default('BaiSmp'),
  MC_HOST: z.string().default('127.0.0.1'),
  MC_RCON_HOST: z.string().optional().default(''),
  MC_QUERY_PORT: z.coerce.number().default(25565),
  MC_RCON_PORT: z.coerce.number().default(25575),
  MC_RCON_PASSWORD: z.string().optional().default(''),
  PLUGIN_API_URL: z.string().default('http://127.0.0.1:8765'),
  MC_WORLD_PATH: z.string().optional().default(''),
  MC_LOG_PATH: z.string().optional().default(''),
  MC_BACKUP_PATH: z.string().default('./backups'),
  PLUGIN_WEBHOOK_PORT: z.coerce.number().int().min(1).max(65535).default(3001)
});

function loadEnv() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}

module.exports = { loadEnv };
