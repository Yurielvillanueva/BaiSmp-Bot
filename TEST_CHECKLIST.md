# Test Checklist

Use this checklist to verify all features are working correctly after deployment.

## 1. Core Functionality

### Discord Bot Startup
- [ ] Bot starts without errors
- [ ] Connects to Discord successfully
- [ ] Logs "discord ready" with bot tag
- [ ] Database migrations applied
- [ ] Config seeded from `.env`

### Database
- [ ] SQLite database created at `DATABASE_PATH`
- [ ] Schema migrations applied (check `schema_migrations` table)
- [ ] Config values seeded correctly
- [ ] Server record created in `servers` table

### HTTP Server
- [ ] `/health` endpoint returns `{"ok":true}`
- [ ] `/metrics` endpoint returns Prometheus format (with auth token)
- [ ] Plugin webhook endpoint accepts POST requests
- [ ] Votifier endpoint accepts POST requests

## 2. Live Status Feature

### Status Embed
- [ ] Status embed appears in #status channel
- [ ] Embed shows online/offline status
- [ ] Player count displays correctly (X/Y)
- [ ] Version information shown
- [ ] MOTD displayed (color codes stripped)
- [ ] Ping latency shown
- [ ] TPS shown (from plugin)
- [ ] Player list shown (up to 25 players)
- [ ] Channel renames to `{server}-{count}` (respects rate limits)

### Bot Presence
- [ ] Bot presence shows "X/Y players"
- [ ] Presence updates every 30 seconds
- [ ] Presence shows "online" when players online, "idle" when empty

### Server Offline Handling
- [ ] Status shows "Offline" when server down
- [ ] Exponential backoff works (retry intervals increase)
- [ ] After 3 consecutive failures, crash alert dispatched
- [ ] When server recovers, "server online" alert dispatched

## 3. Account Linking

### In-Game Link Code
- [ ] `/discordlink` command in-game generates 6-character code
- [ ] Code is uppercase alphanumeric (no ambiguous chars)
- [ ] Code shown to player with instructions
- [ ] Code expires after 10 minutes
- [ ] Code is one-time use (second attempt fails)

### Discord Link Command
- [ ] Discord `/link` command accepts a valid code
- [ ] Invalid/expired code shows error message
- [ ] Link succeeds and assigns "Linked" role
- [ ] Discord ID, UUID, username stored in database
- [ ] Only one Minecraft account per Discord user (configurable)
- [ ] Attempting to link second account shows limit error
- [ ] With DiscordSRV enabled, a verified account link is synchronized to MCBridge when the player joins
- [ ] DiscordSRV link and unlink events update only the matching Minecraft/Discord account pair

### Whois Command
- [ ] `/whois user:@user` shows linked account info
- [ ] `/whois player:username` shows linked account info
- [ ] Displays UUID, Discord mention, link timestamp
- [ ] Works for staff only (helper tier)
- [ ] Shows "No linked account found" for unlinked users

### Unlink Command
- [ ] `/unlink` removes database record
- [ ] Removes "Linked" role
- [ ] Can link again after unlinking

### Username Refresh
- [ ] Username updates when player changes name
- [ ] Scheduled job runs every 6 hours
- [ ] Checks Mojang API for current username
- [ ] Updates database if changed

## 4. Server Console and RCON Access

### Console Command
- [ ] `/console run command:list` works for helpers
- [ ] Output displayed in embed (code block)
- [ ] Command logged to staff log
- [ ] RCON allowlist enforced
- [ ] Blocked commands (stop, op, deop) rejected
- [ ] Destructive commands require confirmation button
- [ ] Confirmation button executes command after click

### RCON Permissions
- [ ] Helper can run: say, list, tps, whitelist list
- [ ] Mod can run: all helper + kick, mute, tempban, pardon
- [ ] Admin can run: all mod + ban, save-all, whitelist add/remove
- [ ] Owner can run: * (except blocked)
- [ ] Non-staff cannot use console command

### Kill Switch
- [ ] `/killswitch state:on` disables all RCON features
- [ ] Console command shows "RCON disabled" message
- [ ] `/killswitch state:off` re-enables RCON
- [ ] Only owners can use kill switch

### Log Tail
- [ ] Minecraft logs appear in #console channel
- [ ] Lines batched every 2 seconds
- [ ] Color codes stripped from logs
- [ ] IP addresses masked (replaced with [ip])
- [ ] Long lines split at 2000 characters
- [ ] Logs continue streaming after server restart

### Chat Bridge (Optional)
- [ ] Enable via config (`chat_bridge_enabled=true`)
- [ ] Discord messages appear in-game with "[Discord]" prefix
- [ ] In-game chat appears in Discord channel
- [ ] Bot messages filtered out
- [ ] IPs masked in both directions

## 5. Automated Event Alerts

### Player Events
- [ ] Join event alert dispatched
- [ ] Leave event alert dispatched
- [ ] First join event alert dispatched
- [ ] Death event alert dispatched (with death message)
- [ ] Advancement event alert dispatched (excludes recipes)

### Server Events
- [ ] Server start alert dispatched (plugin onEnable)
- [ ] Server stop alert dispatched (plugin onDisable)
- [ ] Crash alert dispatched (3 failed status checks)
- [ ] TPS alert dispatched when below threshold (default 16)
- [ ] RAM alert dispatched when above threshold (default 90%)

### Alert Configuration
- [ ] `/alerts set` can toggle each event type
- [ ] Can route alerts to specific channels
- [ ] `/alerts list` shows current routing
- [ ] Default channel used when not specified

## 6. Ticket System

### Ticket Panel
- [ ] `/ticketpanel` posts panel message in channel
- [ ] Panel has "Open ticket" button
- [ ] Panel shows description

### Opening Tickets
- [ ] Button opens modal (category, reason, Minecraft name)
- [ ] Private channel created with correct permissions
- [ ] Channel named `ticket-XXXX`
- [ ] Ticket number increments correctly
- [ ] Channel placed in ticket category
- [ ] Staff roles have view/send permissions
- [ ] User has view/send permissions
- [ ] Everyone else denied
- [ ] Embed shows ticket number and reason
- [ ] Buttons: Claim, Close, Add user
- [ ] Limit enforced (max 2 open tickets per user)

### Ticket Actions
- [ ] Claim button assigns staff member
- [ ] Close button generates HTML transcript
- [ ] Transcript saved to `data/transcripts/`
- [ ] Transcript sent to #ticket-log channel
- [ ] Transcript DM'd to user
- [ ] Channel deleted after close
- [ ] Add user button prompts for mention
- [ ] Mentioned user gets channel permissions

### Idle Tickets
- [ ] Scheduled job closes idle tickets (default 48 hours)
- [ ] Last activity timestamp updated on messages

## 7. Whitelist System

### Application
- [ ] `/whitelist apply` opens modal for non-linked users
- [ ] For linked users, uses linked username
- [ ] Validates username with Mojang API
- [ ] Supports Bedrock names with Floodgate prefix
- [ ] Creates pending application in database
- [ ] Shows embed with Approve/Deny buttons

### Approval
- [ ] Approve button runs `whitelist add` via RCON
- [ ] Assigns "Whitelisted" role
- [ ] DMs user with approval message
- [ ] Logs action to staff log
- [ ] Deny button updates status to denied
- [ ] Only mods can approve/deny

### Management
- [ ] `/whitelist remove username` runs `whitelist remove` via RCON
- [ ] `/whitelist list` shows whitelist output
- [ ] Only mods can use remove/list

## 8. Player Statistics

### Stats Command
- [ ] `/stats player username` shows player stats
- [ ] Displays: playtime, deaths, mob kills, blocks mined, distance traveled, joins
- [ ] Shows player head avatar (mc-heads.net)
- [ ] Caches results for 60 seconds
- [ ] Falls back to world/stats/<uuid>.json if plugin unavailable
- [ ] Shows error if stats unavailable

### Leaderboards
- [ ] `/top playtime` shows top 10 by playtime
- [ ] `/top kills` shows top 10 by mob kills
- [ ] `/top deaths` shows top 10 by deaths
- [ ] Only includes linked accounts
- [ ] Fetches stats from plugin API

## 9. Staff Log Book

### Adding Notes
- [ ] `/logbook add player note` creates entry
- [ ] Generates case ID
- [ ] Logs actor, target, action, reason, timestamp

### Viewing Logs
- [ ] `/logbook view player` shows player's history
- [ ] Shows case IDs, actions, reasons, timestamps
- [ ] `/logbook search query` searches across all logs
- [ ] Can filter by action type

### Export
- [ ] `/logbook export` generates CSV
- [ ] Includes all fields: case_id, actor, target, action, reason, result, created_at
- [ ] Downloaded as file attachment

### Logging Coverage
- [ ] All moderation actions logged
- [ ] RCON commands logged
- [ ] Whitelist decisions logged
- [ ] Ticket actions logged
- [ ] Config changes logged
- [ ] Each entry posted to #staff-log as embed

## 10. Moderation Suite

### Warning
- [ ] `/warn user/player reason` creates warning
- [ ] Applies in Discord (no action needed)
- [ ] Sends in-game message via RCON
- [ ] Generates case ID
- [ ] Logs to staff log
- [ ] Escalates after 3 warns in 30 days (configurable)

### Mute
- [ ] `/mute user/player` applies mute role
- [ ] Sets Discord timeout (if temp)
- [ ] Runs `mute` command via RCON
- [ ] Duration parsed from "7d", "12h" format
- [ ] Logs to staff log

### Kick
- [ ] `/kick user/player reason` kicks from Discord
- [ ] Runs `kick` command via RCON
- [ ] Logs to staff log

### Ban
- [ ] `/ban user/player reason` bans from Discord
- [ ] Runs `ban` command via RCON
- [ ] Logs to staff log
- [ ] Case ID generated

### Tempban
- [ ] `/tempban user/player duration reason` bans with expiry
- [ ] Duration parsed correctly
- [ ] Scheduled job lifts expired bans
- [ ] Removes Discord ban when expired
- [ ] Runs `pardon` via RCON when expired

### Escalation
- [ ] 3 warns in 30 days triggers 24h mute
- [ ] Configurable window and duration
- [ ] Escalation logged as system action

### Ban Sync
- [ ] Discord bans synced to Minecraft
- [ ] Linked accounts checked
- [ ] RCON `ban` command run for linked users

## 11. Appeals

### Opening Appeal
- [ ] `/appeal case_id explanation` creates appeal channel
- [ ] Validates case ID exists and is active
- [ ] Channel placed in appeals category
- [ ] Staff roles have permissions
- [ ] User has permissions
- [ ] Shows embed with case ID and explanation
- [ ] Shows Accept/Deny buttons

### Voting
- [ ] Staff can vote Accept or Deny
- [ ] Votes tracked (accept_votes, deny_votes)
- [ ] Minimum votes required (default 2)
- [ ] When threshold reached, action taken
- [ ] Accept lifts ban on both platforms
- [ ] Deny keeps ban active
- [ ] Result logged to staff log
- [ ] Status updated in database

## 12. Vote and Reward System

### Vote Recording
- [ ] Votifier webhook accepted at `/votifier`
- [ ] Vote recorded in database
- [ ] Reward command run via RCON
- [ ] Alert posted to #votes channel

### Vote Stats
- [ ] `/votes player` shows total votes and streak
- [ ] `/topvoters` shows leaderboard
- [ ] Streak calculated from consecutive days

### Daily Reward
- [ ] `/daily` claims reward for linked users
- [ ] Reward command run via RCON
- [ ] Streak bonus applied
- [ ] Cooldown enforced (default 20 hours)
- [ ] Error message if cooldown not met

### Booster Reward
- [ ] Discord boost triggers reward
- [ ] Linked account checked
- [ ] Reward command run via RCON
- [ ] Configurable command

## 13. Rank and Permission Sync

### Discord to LuckPerms
- [ ] Role change triggers RCON commands
- [ ] `lp user parent add` for new roles
- [ ] `lp user parent remove` for removed roles
- [ ] Temporary ranks supported (expiry)
- [ ] Donor ranks supported

### LuckPerms to Discord
- [ ] Plugin webhook sends `lp_sync` event
- [ ] Discord roles updated based on groups
- [ ] Groups mapped to role IDs in database

### Configuration
- [ ] `/config` can map roles to groups
- [ ] Supports donor flag and expiry
- [ ] Mapping stored in `rank_links` table

## 14. Multi-Server Network Support

### Server Registry
- [ ] Multiple servers can be added to `servers` table
- [ ] Each server has own status embed
- [ ] Each server has own console channel
- [ ] Each server has own alert routing

### Network Commands
- [ ] `/server list` shows all servers
- [ ] Shows player counts per server
- [ ] Shows total network player count
- [ ] Status command can target specific server

## 15. Backups and Maintenance

### Manual Backup
- [ ] `/backup now` runs backup
- [ ] `save-off` run via RCON
- [ ] `save-all` run via RCON
- [ ] World archived (tar or zip)
- [ ] Backup encrypted with AES-256-GCM
- [ ] `save-on` run via RCON
- [ ] Backup path stored in database
- [ ] Logged to staff log

### Backup Pruning
- [ ] Old backups deleted automatically
- [ ] Keeps last N backups (default 7)
- [ ] Database record cleaned up

### Scheduled Backups
- [ ] Cron job can schedule backups
- [ ] Insert into `scheduled_jobs` table
- [ ] Runs without staff intervention

### Maintenance Mode
- [ ] `/maintenance on` enables whitelist
- [ ] `/maintenance off` disables whitelist
- [ ] Status embed shows "Maintenance"
- [ ] Only admins can toggle

### Restart
- [ ] `/restart` schedules restart
- [ ] Warns at 5 minutes
- [ ] Warns at 1 minute
- [ ] Warns at 10 seconds
- [ ] Runs `stop` via RCON

## 16. Performance Monitoring

### Sampling
- [ ] TPS collected every minute
- [ ] MSPT collected
- [ ] RAM usage collected
- [ ] CPU usage collected
- [ ] Chunk count collected
- [ ] Entity count collected
- [ ] Lag sources collected (if available)

### Storage
- [ ] Samples stored in `perf_samples` table
- [ ] Old samples deleted after 7 days
- [ ] Indexed by server and time

### Alerts
- [ ] TPS alert when below threshold
- [ ] RAM alert when above threshold
- [ ] Alert includes top lag sources

### Chart
- [ ] `/perf` command renders chart
- [ ] Shows TPS and MSPT over 7 days
- [ ] Uses chartjs-node-canvas
- [ ] Returns PNG image

## 17. Anti-Abuse and Raid Protection

### IP Hashing
- [ ] Player join IP hashed (SHA-256)
- [ ] Hash stored with UUID and username
- [ ] Never stores raw IP
- [ ] First seen and last seen timestamps

### Alt Detection
- [ ] Same IP detected for different UUIDs
- [ ] Alert posted if alt shares IP with banned player
- [ ] Alert posted for any alt (configurable)

### Raid Lock
- [ ] Discord join rate monitored
- [ ] Locks channels if threshold exceeded (default 12/min)
- [ ] Disables Send Messages for @everyone
- [ ] Staff can still post
- [ ] Manual unlock needed

### Verification Gate
- [ ] New Discord members checked
- [ ] Account age verified (default 24 hours)
- [ ] Kicks if too new
- [ ] Configurable via `verification_gate`

### Spam Filter
- [ ] Invite links blocked (discord.gg, discord.com/invite)
- [ ] Character collapse spam detected
- [ ] Message deleted if filtered
- [ ] User notified of reason
- [ ] Configurable via `invite_filter` and `spam_filter`

## 18. Events and Giveaways

### Scheduled Events
- [ ] `/event create` creates Discord Scheduled Event
- [ ] Sets name, description, start time
- [ ] Event ID stored in database
- [ ] Reminder sent 1 hour before
- [ ] Reminder sent 5 minutes before
- [ ] Reminders marked as sent

### Giveaways
- [ ] `/giveaway` starts giveaway
- [ ] Configurable prize, duration, winners
- [ ] Entry rules: linked account, minimum playtime
- [ ] Button to enter
- [ ] Entries tracked in database
- [ ] Winners picked randomly when ended
- [ ] Reward commands run for winners
- [ ] Results announced in channel

## 19. Web Dashboard

### Authentication
- [ ] OAuth2 login works
- [ ] Redirects to Discord
- [ ] Fetches user info
- [ ] Checks staff roles
- [ ] Session created with 8-hour expiry
- [ ] CSRF protection on POST requests

### Pages
- [ ] `/` shows live status for all servers
- [ ] `/logbook` shows searchable log (staff only)
- [ ] `/tickets` shows open tickets (staff only)
- [ ] `/stats` shows player stats
- [ ] `/admin/config` shows config editor (staff only)
- [ ] `/admin/alerts` shows alert routing (staff only)

### Config Editing
- [ ] Can edit config values via form
- [ ] Changes audited in `config_audit` table
- [ ] Changes applied immediately

### Security
- [ ] Helmet headers enabled
- [ ] Rate limiting (120 req/min)
- [ ] Session cookie httpOnly
- [ ] Staff role check on all admin routes

## 20. Configuration and Localization

### Config Command
- [ ] `/config` shows list of settings
- [ ] Select menu to choose setting
- [ ] Modal to edit value
- [ ] JSON values parsed correctly
- [ ] Changes audited
- [ ] Only owners can use

### Localization
- [ ] English translations loaded
- [ ] Spanish translations loaded
- [ ] Configurable via `locale` setting
- [ ] Fallback to English if missing
- [ ] Variable substitution works ({username}, etc.)

### Theme
- [ ] Embed color configurable
- [ ] Embed footer configurable
- [ ] Applied to all embeds

## 21. Observability

### Health Endpoint
- [ ] `/health` returns `{"ok":true}`
- [ ] Includes request ID
- [ ] Includes uptime

### Metrics Endpoint
- [ ] `/metrics` returns Prometheus format
- [ ] Requires Bearer token if configured
- [ ] Shows: commands_total, errors_total, rcon_total

### Error Webhook
- [ ] Unhandled errors sent to webhook
- [ ] Includes stack trace
- [ ] Includes context
- [ ] Configured via `ERROR_WEBHOOK_URL`

### Diagnostics Command
- [ ] `/diagnostics` checks all systems
- [ ] Discord connection status
- [ ] Database status
- [ ] RCON status
- [ ] Plugin API status
- [ ] Server ping status
- [ ] Only admins can use

## 22. Paper Plugin

### HTTP Server
- [ ] HTTP server starts on configured port
- [ ] Bound to localhost by default
- [ ] `/v1/health` endpoint works
- [ ] `/v1/perf` endpoint works
- [ ] `/v1/stats/<uuid>` endpoint works
- [ ] HMAC signature verification works
- [ ] Timestamp validation works (30s window)

### In-Game Command
- [ ] `/discordlink` command works
- [ ] Generates 6-character code
- [ ] Sends webhook to bot
- [ ] Code expires after 10 minutes

### Event Webhooks
- [ ] Join event sent
- [ ] Leave event sent
- [ ] First join event sent
- [ ] Death event sent
- [ ] Advancement event sent
- [ ] Chat event sent (if enabled)
- [ ] All events signed with HMAC

### TPS Watch
- [ ] TPS checked every 30 seconds
- [ ] Alert sent if below threshold
- [ ] Configurable threshold

## 23. Docker and PM2

### Docker
- [ ] `docker-compose up -d` builds and starts
- [ ] Bot container starts
- [ ] Database container starts (if postgres profile)
- [ ] Volumes mounted correctly
- [ ] Logs accessible via `docker-compose logs`
- [ ] Container restarts on crash

### PM2
- [ ] `pm2 start ecosystem.config.cjs` starts bot
- [ ] `pm2 list` shows running app
- [ ] `pm2 logs` shows output
- [ ] `pm2 monit` shows metrics
- [ ] Auto-restart on crash works
- [ ] Max memory limit enforced

## 24. Tests

### Unit Tests
- [ ] `npm test` runs without errors
- [ ] RCON allowlist tests pass
- [ ] Link code hashing tests pass
- [ ] Whitelist Floodgate tests pass
- [ ] Duration parsing tests pass
- [ ] IP masking tests pass
- [ ] Stats flattening tests pass

### Linting
- [ ] `npm run lint` passes
- [ ] No warnings

## 25. Security

### Secrets
- [ ] `.env` not in git
- [ ] RCON password encrypted in database
- [ ] Link codes hashed
- [ ] IPs hashed
- [ ] Backups encrypted
- [ ] Logs redact tokens
- [ ] Logs mask IPs

### Access Control
- [ ] Staff tiers enforced
- [ ] RCON allowlists enforced
- [ ] Dashboard requires authentication
- [ ] Metrics require token
- [ ] Kill switch works

### Input Validation
- [ ] RCON commands sanitized
- [ ] User input validated
- [ ] UUIDs validated
- [ ] Durations validated
- [ ] SQL injection prevented (prepared statements)

## Moderation Flow Scenarios

### Warn → Escalate → Mute
1. User misbehaves, staff warns 3 times over 30 days
2. On 3rd warn, automatic 24h mute applied
3. Discord mute role assigned
4. RCON mute command run
5. Case IDs linked in escalation
6. All actions logged

### Ban → Appeal → Accept
1. User banned for griefing
2. User submits appeal with case ID
3. Appeal channel created
4. Staff vote (2+ required)
5. Accept threshold reached
6. Ban lifted on Discord
7. RCON pardon command run
8. Result logged

### Ticket → Close → Transcript
1. User opens ticket via panel
2. Staff claim and resolve
3. Staff clicks close
4. HTML transcript generated
5. Transcript sent to log channel
6. Transcript DM'd to user
7. Channel deleted

### Backup → Restore Test
1. Staff runs `/backup now`
2. World saved and archived
3. Backup encrypted
4. Staff restores from backup (manual test)
5. Verify world integrity
6. Verify backup can be decrypted

## Performance Monitoring Scenarios

### Low TPS Alert
1. Server TPS drops below 16
2. Plugin sends TPS event
3. Bot dispatches alert
4. Alert includes top lag sources
5. Staff notified in alert channel

### High RAM Alert
1. RAM usage exceeds 90%
2. Plugin sends perf data
3. Bot dispatches alert
4. Alert shows percentage
5. Staff notified

### Perf Chart
1. Staff runs `/perf`
2. Chart rendered for 7 days
3. Shows TPS and MSPT
4. Image attached to message
5. Can identify patterns

## Final Sign-Off

- [ ] All tests pass
- [ ] All scenarios tested
- [ ] Security checklist complete
- [ ] Firewall rules configured
- [ ] Backup schedule set
- [ ] Monitoring configured
- [ ] Staff trained on commands
- [ ] Documentation reviewed
- [ ] Emergency procedures documented
- [ ] Rollback plan tested
