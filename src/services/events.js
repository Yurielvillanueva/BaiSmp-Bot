const { GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel } = require('discord.js');
const { sendRcon } = require('./rcon');

function createEventsService(ctx) {
  const { db, env } = ctx;

  return {
    async createScheduled(guild, { name, description, startsAt, channelId }) {
      const ev = await guild.scheduledEvents.create({
        name,
        description: description || '',
        scheduledStartTime: new Date(startsAt),
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: channelId ? GuildScheduledEventEntityType.Voice : GuildScheduledEventEntityType.External,
        channel: channelId || undefined,
        entityMetadata: channelId ? undefined : { location: 'Minecraft server' }
      });
      db.raw.prepare('INSERT INTO events (discord_event_id, name, starts_at) VALUES (?, ?, ?)').run(ev.id, name, startsAt);
      return ev;
    },
    dueReminders() {
      const now = Date.now();
      const hour = db.raw.prepare('SELECT * FROM events WHERE reminded_1h = 0 AND starts_at BETWEEN ? AND ?').all(now + 55 * 60000, now + 65 * 60000);
      const five = db.raw.prepare('SELECT * FROM events WHERE reminded_5m = 0 AND starts_at BETWEEN ? AND ?').all(now + 4 * 60000, now + 6 * 60000);
      return { hour, five };
    },
    mark(id, field) {
      db.raw.prepare(`UPDATE events SET ${field} = 1 WHERE id = ?`).run(id);
    },
    async createGiveaway({ channelId, messageId, prize, winners, requireLinked, minPlaytime, endsAt, rewardCommand }) {
      const info = db.raw.prepare(`INSERT INTO giveaways (message_id, channel_id, prize, winners, require_linked, min_playtime_min, ends_at, reward_command)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(messageId, channelId, prize, winners, requireLinked ? 1 : 0, minPlaytime, endsAt, rewardCommand || null);
      return info.lastInsertRowid;
    },
    enter(giveawayId, discordId) {
      db.raw.prepare('INSERT OR IGNORE INTO giveaway_entries (giveaway_id, discord_id) VALUES (?, ?)').run(giveawayId, discordId);
    },
    async pickWinners(giveaway) {
      const entries = db.raw.prepare('SELECT discord_id FROM giveaway_entries WHERE giveaway_id = ?').all(giveaway.id);
      const shuffled = entries.map((e) => e.discord_id).sort(() => Math.random() - 0.5);
      const winners = shuffled.slice(0, giveaway.winners);
      db.raw.prepare("UPDATE giveaways SET status = 'ended' WHERE id = ?").run(giveaway.id);
      const server = db.servers.all()[0];
      if (giveaway.reward_command && server) {
        for (const id of winners) {
          const linked = db.raw.prepare('SELECT * FROM linked_accounts WHERE discord_id = ?').get(id);
          if (linked) {
            const cmd = giveaway.reward_command.replaceAll('{name}', linked.username).replaceAll('{uuid}', linked.minecraft_uuid);
            await sendRcon(env, db, server, cmd).catch(() => {});
          }
        }
      }
      return winners;
    },
    dueGiveaways() {
      return db.raw.prepare("SELECT * FROM giveaways WHERE status = 'open' AND ends_at <= ?").all(Date.now());
    }
  };
}

module.exports = { createEventsService };
