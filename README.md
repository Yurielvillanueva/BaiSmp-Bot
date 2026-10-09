# MC Discord Bridge

Production Discord bot + Paper plugin for Minecraft 1.21 (Paper). Slash commands only.

## Architecture

- **Bot (Node 20)** — discord.js v14, SQLite (`better-sqlite3`) with SQL migrations, RCON, status pings, tickets, and moderation.
- **Paper plugin (Java 21)** — local HMAC HTTP API for TPS/stats/health, DiscordSRV account-link synchronization, and event webhooks to the bot. `/discordlink` remains available as a fallback.
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
6. Build the plugin: `cd plugin && mvn -q package` and drop the jar into the Paper `plugins/` folder. Set `hmac-secret` to the same value as `HMAC_SHARED_SECRET`; keep both endpoints on loopback when the bot and Paper server share a machine. The bot accepts signed plugin events at `http://127.0.0.1:3000/plugin/event`, and the bot calls the plugin API at `http://127.0.0.1:8765`.

<<<<<<< HEAD
### Deploying on Render

This is a Discord bot, not a website: create a **Background Worker** using `npm install` and `npm start`. In the service's **Environment** settings, add `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `CREDENTIALS_KEY`, `BACKUP_ENCRYPTION_KEY`, and `HMAC_SHARED_SECRET`. Use a newly reset Discord token; never copy credentials from `.env.example`. Generate unique random values for the keys, and keep `HMAC_SHARED_SECRET` identical to the value in the Paper plugin config. Preserve `CREDENTIALS_KEY` when reusing a database with encrypted server credentials. If using SQLite, attach persistent storage and set `DATABASE_PATH` to a path on that disk. Redeploy after saving. Do not deploy this app as a public Web Service or expose its local HTTP/RCON ports.

=======
>>>>>>> 97f8969a7078f9935ba1dce949c6e4868f58ad90
MCBridge optionally integrates with DiscordSRV (soft dependency). If DiscordSRV is installed and enabled, the plugin mirrors its verified account links to the bot when a player joins and when DiscordSRV links or unlinks an account. Players use DiscordSRV's own account-link flow; they do not need to run MCBridge's `/discordlink`. If DiscordSRV is not installed, `/discordlink` remains available as a secure fallback: enter its code with Discord's `/link` command. The bot listens for signed plugin webhooks on loopback port `3001` (configurable with `PLUGIN_WEBHOOK_PORT`), on the `/plugin/event` path only. It never guesses a Discord account from a Minecraft name.

If Paper and the bot are on separate machines, `127.0.0.1` in the plugin webhook points back to the Paper host, not the bot. Keep the bot listener bound to loopback and use a secure outbound tunnel from the bot host to expose only `http://127.0.0.1:3001`; set Paper's `bot-webhook` to the tunnel's HTTPS URL plus `/plugin/event`. For a temporary Cloudflare Quick Tunnel, run `cloudflared tunnel --url http://127.0.0.1:3001` on the bot host and use its generated HTTPS hostname. Keep that process running, and update Paper's plugin configuration if its temporary hostname changes. The HMAC secret in Paper's `plugins/MCBridge/config.yml` must exactly match `HMAC_SHARED_SECRET` in the bot's `.env`. Do not forward the bot's main HTTP port or RCON port publicly. The plugin accepts remote webhook URLs only over HTTPS; HTTP is permitted only for loopback testing.

With DiscordSRV installed, link through DiscordSRV and then join the server; MCBridge will synchronize the verified account automatically. Without DiscordSRV, run `/discordlink` in Minecraft and submit the generated code using Discord's `/link` command within 10 minutes. Staff can run `/diagnostics` to verify the plugin health connection.

### Keep the bot running on Windows

Install PM2 globally (`npm install --global pm2`), then from the project folder run:

```powershell
npm run service:install
pm2 start ecosystem.config.cjs
npm run service:save
pm2 status
```

PM2 restarts the bot after a crash. The scheduled task restores PM2's saved process list when the current Windows user logs in after a restart; it does not run before that user logs in. Keep the account signed in, the computer powered on and connected to the internet, and prevent it from sleeping. This keeps the bot online while the host is available, but cannot provide uptime when the computer or network is off. For independent 24/7 hosting, deploy it to an always-on VPS or cloud host instead.

## Discord Developer Portal

Create an application → Bot.

**Privileged intents:** Server Members Intent. Enable Message Content Intent only if you use the chat bridge or invite/spam filter.

**OAuth2 URL generator:** scopes `bot` and `applications.commands`.

**Bot permissions (least privilege that still covers tickets/moderation):** View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Manage Roles, Manage Channels, Manage Messages, Ban Members, Kick Members, Moderate Members, Manage Events (giveaways/events).

Invite the bot to your guild, create roles (Linked, Helper, Mod, Admin, Developer, Head Developer, Owner, Muted, Verified, Whitelisted) and paste their IDs into `.env`. Create channels for status, console, staff-log, tickets category, appeals, alerts. All configured staff roles can view and manage private ticket channels.

The configured Head Developer role receives the same bot command access as Owner, including owner-tier bot commands. Discord administrator permissions are not required for the bot's role-based command checks.

Ticket requests are handled entirely inside Discord; no website is needed. Run `/ticketpanel` in the channel where players should open tickets. The panel offers separate support, purchase/store, staff recruitment, technical issue, player report, and other forms. Duplicate submissions are ignored. Configure `TICKET_LOG_CHANNEL_ID` for ticket lifecycle logs and HTML transcripts; the bot needs permission to view and send messages and attach files in that channel. Staff can claim tickets, add server members by Discord user ID, and close tickets with transcript delivery. Staff can use `/ticketqueue` to review open tickets, filter for staff recruitment, and see the owner, claim status, and channel link. Recruitment form answers are included with the opened-ticket log.

Use `/logbook case` to inspect a specific audit case. `/logbook search` finds recorded actions, and `/logbook export` sends a CSV with all audit columns properly escaped. Admins can use `/staffreport activity`, `/staffreport moderation`, and `/staffreport audit` for private staff activity counts, moderation totals, and recent audit records filtered by period, staff member, and exact action. `/playeraudit` lets moderators privately inspect a Discord user's linked Minecraft account or a Minecraft username, including recent punishment cases, active status, expiry, and issuing staff member. Reports support 24-hour, 7-day, 30-day, or all-time ranges. `/diagnostics` checks Discord, SQLite, RCON, the plugin API, and Minecraft status/query; its optional `server` option selects which configured server to check and includes actionable failure details. A working Minecraft query does not mean RCON is exposed: game hosts often assign a separate external RCON endpoint, so set `MC_RCON_HOST` and `MC_RCON_PORT` to the host-provided values and restrict access to the bot. For a bot on a separate machine, `PLUGIN_API_URL=http://127.0.0.1:8765` points back to the bot itself; use only a private or HTTPS plugin endpoint supplied by the host, and do not expose the plugin API port publicly.

Appeals are also Discord-only: players use `/appeal submit` with their linked Minecraft username (or punishment case ID) and reason, `/appeal status`, `/appeal add`, and `/appeal cancel`. Username submissions still require the punishment to belong to the requester or their linked account. Staff use `/appeal list`, `/appeal view`, `/appeal accept`, `/appeal deny`, `/appeal reduce`, `/appeal note`, `/appeal assign`, `/appeal close`, and `/appeal history`; staff accept, deny, and reduce decisions follow `appeal_min_votes`. `/appeal reduce` is for active AdvancedBan temporary bans only, requires a shorter remaining duration, and needs a working AdvancedBan RCON connection. If AdvancedBan returns an empty or error-like response, or RCON is unavailable, the bot does not mark the reduction complete; the command attempts to restore the original remaining duration after an uncertain replacement failure.

Bot command failures and uncaught process errors are reported to `ERROR_CHANNEL_ID` (or `STAFF_LOG_CHANNEL_ID` if the error channel is unset). Set `ERROR_NOTIFY_ROLE_ID` to a staff role the bot may mention. The notification channel must allow the bot to view the channel, send messages, and embed links. For this server, use the private `#staff-commands` channel and the Head Developer/staff role.

Staff can use `/ticketqueue` to list active (`status:Active`) or closed tickets, filter by category, or choose `action:Remove ticket` and a ticket number. Removal asks for confirmation. Active tickets are closed with a transcript saved and sent before they are hidden from the queue; the audit record remains in the database with status `deleted`.

Use `/status` to publish or refresh a live status panel for each configured Minecraft server in the current channel. The bot edits these saved panels automatically at the interval configured by `STATUS_INTERVAL_MS` (30 seconds by default); if a panel is deleted, it is recreated on the next automatic refresh. To check a server directly without creating a live panel, enter its IP/hostname in `address` and its query port in `port` (defaults to `25565`); do not include the port in the address field. The embed includes online state, player counts and listed names, MOTD, server address, detected version, and supported versions (1.21–1.21.11). No website link is included.

Player commands include `/online [server]` to show counts and available player names for configured servers, and `/playtime` to privately check the playtime of your linked Minecraft account. `/playtime` needs readable Minecraft statistics through the plugin API or configured world stats path.

`/maintenance state:on|off` changes the Minecraft whitelist and updates the server's maintenance status only after the RCON command succeeds. If multiple servers are configured, specify the server name with the command's `server` option. `/backup now` needs `MC_WORLD_PATH` to point to a readable Minecraft world directory on the bot machine, plus a working RCON connection. A bot on a different host cannot directly archive the Paper server's world files; configure backups in the hosting panel or run the bot/backup job on the Minecraft host. Redeploy slash commands with `npm run deploy` after updating the bot.

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
- Bot HTTP (`3000`) is bound to `127.0.0.1` for health checks and plugin webhooks.

## PostgreSQL later

SQLite is the default. `docker-compose` includes a Postgres service under profile `postgres`. Keep SQL migrations vendor-neutral (no SQLite-only types beyond INTEGER/TEXT) so a pg adapter can replace `src/db/index.js`.

## Tests

`npm test` covers RCON allowlists, link code hashing/one-time use, whitelist Floodgate names, mute/ban durations, IP masking.

## License

Private / your server. Keep credentials out of git.
