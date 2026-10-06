const { cfg } = require('../config/store');
const { embed } = require('../util/embeds');
const { PermissionFlagsBits } = require('discord.js');
const { logger } = require('../logger');

const joins = [];

async function noteIpHash(ctx, body) {
  const { db, client } = ctx;
  const hashed = body.hashedIp;
  const uuid = body.uuid;
  if (!hashed || !uuid) return;
  const now = Date.now();
  const existing = db.raw.prepare('SELECT * FROM ip_hashes WHERE hashed_ip = ? AND minecraft_uuid = ?').get(hashed, uuid);
  if (existing) {
    db.raw.prepare('UPDATE ip_hashes SET last_seen = ?, username = ? WHERE hashed_ip = ? AND minecraft_uuid = ?')
      .run(now, body.username, hashed, uuid);
  } else {
    db.raw.prepare('INSERT INTO ip_hashes (hashed_ip, minecraft_uuid, username, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)')
      .run(hashed, uuid, body.username, now, now);
  }
  const alts = db.raw.prepare('SELECT * FROM ip_hashes WHERE hashed_ip = ? AND minecraft_uuid != ?').all(hashed, uuid);
  if (!alts.length) return;
  const banned = alts.filter((a) => db.raw.prepare("SELECT 1 FROM punishments WHERE target_uuid = ? AND type IN ('ban','tempban') AND active = 1").get(a.minecraft_uuid));
  const channelId = process.env.ALERT_DEFAULT_CHANNEL_ID || ctx.db.servers.all()[0]?.alert_channel_id;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;
  await channel.send({
    embeds: [embed(db, {
      title: banned.length ? 'Possible ban evasion' : 'Alt account flag',
      description: `${body.username} shares a hashed IP with ${alts.map((a) => a.username).join(', ')}`
    })]
  });
}

function recordDiscordJoin() {
  const now = Date.now();
  joins.push(now);
  while (joins.length && now - joins[0] > 60000) joins.shift();
  return joins.length;
}

async function maybeRaidLock(ctx, member) {
  const { db } = ctx;
  const count = recordDiscordJoin();
  if (count < cfg(db, 'raid_joins_per_minute')) return;
  const guild = member.guild;
  const state = db.raw.prepare('SELECT * FROM raid_state WHERE guild_id = ?').get(guild.id);
  if (state?.locked) return;
  db.raw.prepare(`INSERT INTO raid_state (guild_id, locked, locked_at) VALUES (?, 1, ?)
    ON CONFLICT(guild_id) DO UPDATE SET locked = 1, locked_at = excluded.locked_at`).run(guild.id, Date.now());
  for (const ch of guild.channels.cache.values()) {
    if (ch.isTextBased()) {
      await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }).catch(() => {});
    }
  }
  logger.warn({ count }, 'raid lock engaged');
}

async function verificationGate(ctx, member) {
  const { db } = ctx;
  if (!cfg(db, 'verification_gate')) return;
  const ageH = (Date.now() - member.user.createdTimestamp) / 3600000;
  if (ageH < cfg(db, 'account_age_hours')) {
    await member.kick('Account too new').catch(() => {});
    return;
  }
}

function inviteOrSpam(content, db) {
  if (!content) return null;
  if (cfg(db, 'invite_filter') && /(discord\.gg|discord\.com\/invite)\//i.test(content)) return 'invite';
  if (cfg(db, 'spam_filter')) {
    const collapsed = content.replace(/(.)\1{7,}/g, '$1');
    if (content.length > 8 && collapsed.length < content.length / 4) return 'spam';
  }
  return null;
}

module.exports = { noteIpHash, maybeRaidLock, verificationGate, inviteOrSpam, recordDiscordJoin };
