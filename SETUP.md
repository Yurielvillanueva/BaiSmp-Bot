# Setup Guide

This guide walks through deploying the MC Discord Bridge bot and Paper plugin for a production Minecraft 1.21 Paper server.

## Prerequisites

- Node.js 20 or higher
- Java 21 (for building the plugin)
- Maven 3.6+ (for building the plugin)
- Minecraft Paper 1.21 server
- Discord account with server management permissions

## Step 1: Discord Developer Portal Setup

1. Go to https://discord.com/developers/applications
2. Click "New Application" and name it (e.g., "MC Bridge Bot")
3. Navigate to the "Bot" section:
   - Click "Add Bot"
   - Copy the **Token** → paste into `.env` as `DISCORD_TOKEN`
   - Copy the **Application ID** → paste as `DISCORD_CLIENT_ID`
   - Copy the **Client Secret** from OAuth2 section → paste as `DISCORD_CLIENT_SECRET`
4. Enable Privileged Intents:
   - **Server Members Intent** → Enabled (required for role checks)
   - **Message Content Intent** → Enabled (only if using chat bridge or spam filter)
5. Navigate to OAuth2 → URL Generator:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions:
     - View Channels
     - Send Messages
     - Embed Links
     - Attach Files
     - Read Message History
     - Manage Roles
     - Manage Channels
     - Manage Messages
     - Ban Members
     - Kick Members
     - Moderate Members
     - Manage Events
   - Copy the generated URL and invite the bot to your server
6. Copy your **Guild ID** from Discord (right-click server → Copy ID) → paste as `DISCORD_GUILD_ID`

## Step 2: Create Discord Roles and Channels

### Required Roles (create in your server)
- **Linked** - Assigned when a player links their account
- **Whitelisted** - Assigned when whitelist application is approved
- **Helper** - Basic staff tier
- **Mod** - Moderator tier
- **Admin** - Administrator tier
- **Owner** - Full access
- **Muted** - For Discord-side mutes
- **Verified** - For account age gate (optional)

Copy each role ID (right-click role → Copy ID) into `.env`:
```
LINKED_ROLE_ID= 
WHITELISTED_ROLE_ID=
HELPER_ROLE_ID=
MOD_ROLE_ID=
ADMIN_ROLE_ID=
OWNER_ROLE_ID=
MUTED_ROLE_ID=
VERIFIED_ROLE_ID=
```

### Required Channels
- **#status** - Live server status embed
- **#console** - Minecraft log tail
- **#staff-log** - Staff action log
- **#tickets** - Category for ticket channels
- **#appeals** - Category for appeal channels
- **#alerts** - Default alert channel
- **#votes** - Vote notifications (optional)

Copy channel IDs into `.env`:
```
STATUS_CHANNEL_ID=
CONSOLE_CHANNEL_ID=
CHAT_BRIDGE_CHANNEL_ID=
ALERT_DEFAULT_CHANNEL_ID=
STAFF_LOG_CHANNEL_ID=
TICKET_CATEGORY_ID=
TICKET_LOG_CHANNEL_ID=
APPEAL_CATEGORY_ID=
VOTE_CHANNEL_ID=
```

## Step 3: Configure Minecraft Server

Edit `server.properties`:
```properties
enable-rcon=true
rcon.port=25575
rcon.password=<strong unique password>
enable-query=true
query.port=25565
broadcast-rcon-to-ops=false
```

### Important Security Notes
- Do not publicly expose RCON. Restrict it to localhost, a private network, or the bot's source IP.
- If BaoHost hosts Minecraft and the bot runs elsewhere, `MC_RCON_HOST` and `MC_RCON_PORT` must be set to the host's allocated external RCON endpoint, not the Minecraft query/game endpoint. Ask BaoHost whether remote RCON is supported and request the RCON hostname, port, and access restrictions. AdvancedBan's `config.yml` does not configure RCON.
- A refused connection means the TCP endpoint is not accepting connections; changing the AdvancedBan command text cannot fix it. Keep appeal actions that need RCON disabled until the endpoint is reachable.

### Firewall Rules
```bash
# Allow Minecraft from players
ufw allow 25565/tcp
ufw allow 25565/udp  # if using query

# BLOCK RCON and plugin API from internet
ufw deny 25575/tcp
ufw deny 8765/tcp

# Bot HTTP is localhost-only (no firewall rule needed)
```

## Step 4: Bot Installation

1. Clone or download the bot code
2. Install dependencies:
```bash
npm install
```

3. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

4. Edit `.env` with your values:

### Required Settings
```env
NODE_ENV=production
LOG_LEVEL=info

# Discord (from Step 1)
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_app_id_here
DISCORD_CLIENT_SECRET=your_client_secret_here
DISCORD_GUILD_ID=your_guild_id_here

# Security (generate strong random strings)
CREDENTIALS_KEY=generate-32-byte-random-string-here
BACKUP_ENCRYPTION_KEY=generate-32-byte-random-string-here
HMAC_SHARED_SECRET=generate-32-byte-random-string-here

# Minecraft (from Step 3)
MC_SERVER_NAME=survival
MC_HOST=127.0.0.1
MC_RCON_HOST=127.0.0.1
MC_QUERY_PORT=25565
MC_RCON_PORT=25575
MC_RCON_PASSWORD=your_rcon_password_from_server_properties
PLUGIN_API_URL=http://127.0.0.1:8765

# Paths (adjust to your server)
MC_WORLD_PATH=/path/to/minecraft/world
MC_LOG_PATH=/path/to/minecraft/logs/latest.log
MC_BACKUP_PATH=./backups

# Role IDs (from Step 2)
LINKED_ROLE_ID=
WHITELISTED_ROLE_ID=
HELPER_ROLE_ID=
MOD_ROLE_ID=
ADMIN_ROLE_ID=
OWNER_ROLE_ID=
MUTED_ROLE_ID=
VERIFIED_ROLE_ID=

# Channel IDs (from Step 2)
STATUS_CHANNEL_ID=
CONSOLE_CHANNEL_ID=
CHAT_BRIDGE_CHANNEL_ID=
ALERT_DEFAULT_CHANNEL_ID=
STAFF_LOG_CHANNEL_ID=
TICKET_CATEGORY_ID=
TICKET_LOG_CHANNEL_ID=
APPEAL_CATEGORY_ID=
VOTE_CHANNEL_ID=
```

### Optional Settings
```env
# Dashboard (set to true to enable)
DASHBOARD_ENABLED=false
DASHBOARD_PUBLIC_URL=http://localhost:3000
DASHBOARD_SESSION_SECRET=another-random-string
OAUTH_REDIRECT_URI=http://localhost:3000/auth/callback

# Error reporting
ERROR_WEBHOOK_URL=https://discord.com/api/webhooks/...

# Timeouts (ms)
RCON_TIMEOUT_MS=5000
PLUGIN_API_TIMEOUT_MS=4000
STATUS_INTERVAL_MS=30000
LOG_TAIL_BATCH_MS=2000
PERF_INTERVAL_MS=60000
```

## Step 5: Initialize Database and Deploy Commands

```bash
# Run migrations and seed config
npm run seed

# Deploy slash commands to your guild
npm run deploy
```

## Step 6: Build and Install Paper Plugin

1. Build the plugin:
```bash
cd plugin
mvn clean package
```

2. The JAR will be at `plugin/target/mc-bridge-plugin-1.0.0.jar`
3. Copy it to your Paper server's `plugins/` folder
4. Edit `plugins/MCBridge/config.yml`:
```yaml
http-port: 8765
bind: 127.0.0.1
hmac-secret: same-as-HMAC_SHARED_SECRET-in-.env
bot-webhook: http://127.0.0.1:3000/plugin/event
server-name: survival
tps-threshold: 16.0
```

5. Restart the Paper server

## Step 7: Start the Bot

### Development mode (with auto-reload)
```bash
npm run dev
```

### Production mode
```bash
npm start
```

### Using PM2 (recommended for production)
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### Using Docker
```bash
docker-compose up -d
```

## Step 8: Initial Configuration

Once the bot is running:

1. **Configure RCON allowlists** (via `/config` command or database):
   - Helpers can run: `say`, `list`, `tps`, `whitelist list`
   - Mods can run: `say`, `list`, `tps`, `whitelist`, `kick`, `mute`, `tempban`, `pardon`
   - Admins can run: all above + `ban`, `save-all`, `whitelist add/remove`
   - Owners can run: `*` (except blocked commands)
   - Blocked commands: `stop`, `op`, `deop`
   - Confirm required: `ban-ip`, `whitelist off`, `reload`, `restart`

2. **Configure alerts** (via `/alerts set`):
   - Toggle events: join, leave, first_join, death, advancement, server_start, server_stop, crash, tps, ban, whitelist
   - Route each to specific channels or use default

3. **Test linking**:
   - With DiscordSRV installed, link an account using DiscordSRV's native account-link flow, then join the server; MCBridge should synchronize the verified link automatically.
   - Without DiscordSRV, use `/discordlink` in-game and submit its code with the bot's `/link` command.
   - Verify Minecraft stats associate with the correct Discord account.

4. **Review staff reports** (admin role required):
   - `/staffreport activity` summarizes logged staff actions by time range and can filter to one staff member.
   - `/staffreport moderation` counts warn, mute, kick, and ban actions.
   - `/staffreport audit` filters recent audit entries by time range, staff member, and exact action.
   - Reports are private to the requesting staff member and use recorded staff-log entries.
   - Moderators can use `/playeraudit` with a Discord user or Minecraft username to review a player's linked identity and recent/active punishment cases.

5. **Test status**:
   - Check #status channel for live embed
   - Verify bot presence shows player count

6. **Test console**:
   - Check #console channel for log tail
   - Run `/console run command:list` as staff

## Step 9: Configure Moderation and Tickets

1. **Set up ticket panel**:
   - Run `/ticketpanel` in a public channel
   - Users click to open private tickets

2. **Configure escalation** (via `/config`):
   - `escalation_warns`: 3 (warns before auto-mute)
   - `escalation_window_days`: 30
   - `escalation_mute`: 24h

3. **Configure appeals** (via `/config`):
   - `appeal_min_votes`: 2 (staff votes needed)
   - Create an appeals category and configure `appeal_category_id`; configure the Mod role (and higher roles) so staff can view private appeal channels.
   - Players must use `/appeal submit` with their linked Minecraft username or punishment case ID. Username submissions are not a way to appeal another player's case.
   - Staff appeal commands are `/appeal list`, `view`, `accept`, `deny`, `reduce`, `note`, `assign`, `close`, and `history`. Accept, deny, and reduce decisions require the configured number of distinct staff votes.
   - `/appeal reduce` supports active AdvancedBan temporary bans only. It sends AdvancedBan `unban` and `tempban` commands through RCON, requires the new total duration to be shorter than the remaining ban, and attempts to restore the previous remaining duration if replacing the punishment fails. Verify AdvancedBan command responses and ensure the bot can reach the host's actual RCON endpoint before enabling staff to use it.

## Step 10: Backup and Monitoring

1. **Test backup**:
   - Run `/backup now` as admin
   - Verify encrypted backup file is created

2. **Configure scheduled backups** (insert into `scheduled_jobs` table):
   ```sql
   INSERT INTO scheduled_jobs (kind, cron_expr, payload, enabled)
   VALUES ('backup', '0 4 * * *', '{"server":"survival"}', 1);
   ```

3. **Monitor performance**:
   - Run `/perf` to see TPS/MSPT chart
   - Configure TPS/RAM alerts via `/alerts set`

## Troubleshooting

### Bot won't start
- Check `.env` values are correct
- Verify Discord token is valid
- Check database path is writable

### Commands not responding
- Run `/deploy` again
- Check bot has correct permissions
- Verify slash commands are deployed to the correct guild

### RCON connection failed
- Verify `server.properties` has `enable-rcon=true`
- Check RCON password matches
- Ensure `MC_RCON_HOST` and `MC_RCON_PORT` contain the provider's external RCON hostname/port; do not substitute the game/query endpoint unless the host explicitly confirms it is also the RCON endpoint.
- Allow RCON only from the bot's source IP or private network. Do not open it to the public internet.

### Rotating the bot/plugin HMAC secret
- If the `.env` HMAC secret is rotated, set the identical new value in the Paper server's `plugins/MCBridge/config.yml` under `hmac-secret`, then restart/reload MCBridge and restart the bot.
- Do not paste the secret into Discord, support tickets, or source-controlled YAML files. If BaoHost manages the plugin configuration, update it in their private console/file manager before restarting either service.

### Plugin webhook failing
- Verify `hmac-secret` matches between `.env` and `config.yml`
- Check plugin HTTP is bound to correct interface
- Verify bot HTTP server is running on `127.0.0.1:3000`

### Status not updating
- Check `enable-query=true` in `server.properties`
- Verify query port matches
- Check server is online

### Dashboard not accessible
- Set `DASHBOARD_ENABLED=true` in `.env`
- Restart bot
- Access at `http://localhost:3001` (BOT_HTTP_PORT + 1)
- Check OAuth redirect URI matches

## Security Checklist

- [ ] RCON bound to localhost or private network only
- [ ] RCON port (25575) blocked from internet via firewall
- [ ] Plugin API port (8765) blocked from internet
- [ ] Strong random strings for `CREDENTIALS_KEY`, `BACKUP_ENCRYPTION_KEY`, `HMAC_SHARED_SECRET`
- [ ] `.env` file not committed to git
- [ ] Bot token kept secret
- [ ] Database backups encrypted
- [ ] Staff roles properly configured (least privilege)
- [ ] RCON allowlists reviewed
- [ ] Error webhook URL secured (if used)

## Production Recommendations

1. **Run bot on the same machine as Minecraft** to avoid exposing RCON
2. **Use PM2 or Docker** for process management and auto-restart
3. **Set up log rotation** for `logs/` directory
4. **Monitor disk space** for backups
5. **Regular database backups** (SQLite file)
6. **Review staff logs** weekly for audit trail
7. **Test restoration** from backup periodically
8. **Keep plugin and bot updated** with security patches
9. **Use reverse proxy** (nginx/caddy) if exposing dashboard publicly
10. **Set up Uptime monitoring** for bot HTTP endpoint `/health`
