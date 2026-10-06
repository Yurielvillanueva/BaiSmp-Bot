# MC Discord Bridge

Production Discord bot + Paper plugin for Minecraft 1.21 (Paper). Slash commands only.

## Architecture

- **Bot (Node 20)** — discord.js v14, SQLite (`better-sqlite3`) with SQL migrations, RCON, status pings, tickets, moderation, dashboard.
- **Paper plugin (Java 21)** — local HMAC HTTP API for TPS/stats/health, in-game `/link`, event webhooks to the bot.
- **Secrets** — `.env` and plugin `config.yml` only. RCON passwords are AES-256-GCM encrypted at rest. Link codes are SHA-256 hashed, single-use, 10-minute TTL. IPs are hashed (never stored raw). Logs redact tokens and mask IPs.

RCON belongs on localhost or a private network. Do not publish 25575.

## Folder tree

```
├── src/                    # Bot
│   ├── index.js            # Bootstrap, graceful shutdown
│   ├── bot.js              # Discord client, intents, command dispatch
│   ├── commands/           # Slash commands
│   ├── events/             # Buttons, modals
│   ├── services/           # Domain logic
│   ├── db/migrations/      # SQLite schema
│   ├── dashboard/          # Optional Express OAuth app
│   ├── http/               # /health /metrics plugin webhooks
│   └── i18n/               # en + es
├── plugin/                 # Paper companion
├── tests/                  # Jest unit tests
├── scripts/                # deploy-commands.js, seed.js
├── Dockerfile / docker-compose.yml / ecosystem.config.cjs
└── .github/workflows/ci.yml
```

## Quick start

1. Copy `.env.example` to `.env` and fill Discord + RCON + HMAC values (`CREDENTIALS_KEY` and `HMAC_SHARED_SECRET` must be long random strings).
2. `npm install`
3. `npm run seed`
4. `npm run deploy` (deploys to `DISCORD_GUILD_ID` for fast updates; uses global commands if it is unset)
5. `npm start` or `pm2 start ecosystem.config.cjs`
6. Build the plugin: `cd plugin && mvn -q package` and drop the jar into the Paper `plugins/` folder. Set `hmac-secret` to the same value as `HMAC_SHARED_SECRET`.

### Keep the bot running on Windows

Install PM2 globally (`npm install --global pm2`), then from the project folder run:

```powershell
npm run service:install
pm2 start ecosystem.config.cjs
npm run service:save
pm2 status
```

PM2 restarts the bot after a crash. The scheduled task restores PM2's saved process list when the current Windows user logs in after a restart; it does not run before that user logs in. Keep the account signed in, the computer powered on and connected to the internet, and prevent it from sleeping. This keeps the bot online while the host is available, but cannot provide uptime when the computer or network is off. For independent 24/7 hosting, deploy it to an always-on VPS or cloud host instead.

Dashboard: `DASHBOARD_ENABLED=true` (listens on `BOT_HTTP_PORT+1`). Discord OAuth redirect must match `OAUTH_REDIRECT_URI`.

## Discord Developer Portal

Create an application → Bot.

**Privileged intents:** Server Members Intent. Enable Message Content Intent only if you use the chat bridge or invite/spam filter.

**OAuth2 URL generator:** scopes `bot` and `applications.commands`.

**Bot permissions (least privilege that still covers tickets/moderation):** View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Manage Roles, Manage Channels, Manage Messages, Ban Members, Kick Members, Moderate Members, Manage Events (giveaways/events).

Invite the bot to your guild, create roles (Linked, Helper, Mod, Admin, Owner, Muted, Verified, Whitelisted) and paste their IDs into `.env`. Create channels for status, console, staff-log, tickets category, appeals, alerts.

Ticket requests are handled entirely inside Discord; no website is needed. Run `/ticketpanel` in the channel where players should open tickets. The panel offers separate support, purchase/store, staff recruitment, technical issue, player report, and other forms. Configure `TICKET_LOG_CHANNEL_ID` for ticket lifecycle logs and HTML transcripts; the bot needs permission to view and send messages and attach files in that channel. Staff can claim tickets, add server members by Discord user ID, and close tickets with transcript delivery.

`/maintenance state:on|off` changes the Minecraft whitelist and updates the server's maintenance status only after the RCON command succeeds. If multiple servers are configured, specify the server name with the command's `server` option. Redeploy slash commands with `npm run deploy` after updating the bot.

## server.properties

```
enable-rcon=true
rcon.port=25575
rcon.password=<strong unique password>
enable-query=true
query.port=25565
```

Bind RCON on the loopback interface (firewall drop 25575 from WAN). The bot should run on the same machine or reach RCON over a private interface only.

Optional: `white-list=true` if you use `/maintenance`.

## Firewall

- Allow 25565 (Minecraft) from players.
- Allow 25565 UDP if you rely on query.
- **Deny** 25575 (RCON) and 8765 (plugin HTTP) from the internet.
- Bot HTTP (`3000`) is bound to `127.0.0.1`. Reverse-proxy the dashboard if you need it public (HTTPS + tight firewall).

## PostgreSQL later

SQLite is the default. `docker-compose` includes a Postgres service under profile `postgres`. Keep SQL migrations vendor-neutral (no SQLite-only types beyond INTEGER/TEXT) so a pg adapter can replace `src/db/index.js`.

## Tests

`npm test` covers RCON allowlists, link code hashing/one-time use, whitelist Floodgate names, mute/ban durations, IP masking.

## License

Private / your server. Keep credentials out of git.
