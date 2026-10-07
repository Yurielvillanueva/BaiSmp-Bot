const fs = require('fs');
const path = require('path');
const { cfg } = require('../config/store');
const { PermissionFlagsBits, ChannelType, OverwriteType } = require('discord.js');
const { embed } = require('../util/embeds');
const { logger } = require('../logger');

function nextTicketNumber(db) {
  const row = db.raw.prepare('SELECT MAX(number) AS n FROM tickets').get();
  return (row?.n || 0) + 1;
}

function htmlEscape(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function createTicketService(ctx) {
  const { db, client } = ctx;
  const opensInProgress = new Map();

  async function findDuplicate({ guild, user, category, reason, mcName, submissionId }) {
    const existing = submissionId
      ? db.raw.prepare('SELECT * FROM tickets WHERE submission_id = ?').get(submissionId)
      : null;
    const recent = existing || db.raw.prepare(`SELECT * FROM tickets
      WHERE discord_id = ? AND category = ? AND status = 'open'
        AND reason = ? AND COALESCE(mc_name, '') = COALESCE(?, '')
        AND created_at >= datetime('now', '-45 seconds')
      ORDER BY id DESC LIMIT 1`).get(user.id, category, reason, mcName || '');
    if (!recent) return null;
    const channel = recent.channel_id ? await guild.channels.fetch(recent.channel_id).catch(() => null) : null;
    return { channel, number: recent.number, duplicate: true };
  }

  async function createTicket({ guild, user, category, reason, mcName, submissionId }) {
    const duplicate = await findDuplicate({ guild, user, category, submissionId });
    if (duplicate) return duplicate;

      const open = db.raw.prepare("SELECT COUNT(*) AS c FROM tickets WHERE discord_id = ? AND status = 'open'").get(user.id).c;
      if (open >= cfg(db, 'open_ticket_limit')) throw new Error('TICKET_LIMIT');
      const number = nextTicketNumber(db);
      const parent = cfg(db, 'ticket_category_id');
      const staffRoles = [
        'helper_role_id', 'mod_role_id', 'admin_role_id',
        'developer_role_id', 'head_developer_role_id', 'owner_role_id'
      ]
        .map((k) => cfg(db, k)).filter(Boolean);
      const overwrites = [
        { id: guild.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, type: OverwriteType.Member, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
      ];
      for (const roleId of staffRoles) {
        overwrites.push({
          id: String(roleId),
          type: OverwriteType.Role,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        });
      }
      const channel = await guild.channels.create({
        name: `ticket-${String(number).padStart(4, '0')}`,
        type: ChannelType.GuildText,
        parent: parent || undefined,
        permissionOverwrites: overwrites
      });
      try {
        db.raw.prepare(`INSERT INTO tickets (number, discord_id, channel_id, category, reason, mc_name, status, submission_id)
          VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`).run(number, user.id, channel.id, category, reason, mcName, submissionId || null);
      } catch (err) {
        await channel.delete('Ticket creation failed').catch((deleteErr) => {
          logger.error({ err: deleteErr, channelId: channel.id }, 'failed to remove incomplete ticket channel');
        });
        if (submissionId) {
          const duplicate = await findDuplicate({ guild, user, category, submissionId });
          if (duplicate) return duplicate;
        }
        throw err;
      }
      return { channel, number, duplicate: false };
  }

  return {
    async open(input) {
      const key = `${input.user.id}:${input.category}`;
      const pending = opensInProgress.get(key);
      if (pending) {
        await pending.catch(() => {});
        const duplicate = await findDuplicate(input);
        if (duplicate) return duplicate;
      }
      const opening = createTicket(input);
      opensInProgress.set(key, opening);
      try {
        return await opening;
      } finally {
        if (opensInProgress.get(key) === opening) opensInProgress.delete(key);
      }
    },
    getByChannel(channelId) {
      return db.raw.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId);
    },
    getByNumber(number) {
      return db.raw.prepare('SELECT * FROM tickets WHERE number = ?').get(number);
    },
    claim(ticketId, staffId) {
      db.raw.prepare("UPDATE tickets SET claimed_by = ?, last_activity_at = datetime('now') WHERE id = ?").run(staffId, ticketId);
    },
    touch(channelId) {
      db.raw.prepare("UPDATE tickets SET last_activity_at = datetime('now') WHERE channel_id = ? AND status = 'open'").run(channelId);
    },
    async addUser(ticket, guild, userId) {
      const channel = await guild.channels.fetch(ticket.channel_id);
      const member = await guild.members.fetch(userId);
      await channel.permissionOverwrites.edit(member, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    },
    async logEvent(ticket, action, actorId, { detail, file } = {}) {
      const logId = cfg(db, 'ticket_log_channel_id');
      if (!logId) {
        logger.warn({ ticketNumber: ticket.number, action }, 'ticket log channel is not configured');
        return false;
      }
      let log;
      try {
        log = await client.channels.fetch(logId);
        if (!log?.isTextBased() || typeof log.send !== 'function') {
          logger.warn({ ticketNumber: ticket.number, action, logId }, 'ticket log channel is not text based');
          return false;
        }
        await log.send({
          embeds: [embed(db, {
            title: `Ticket #${ticket.number} · ${action}`,
            fields: [
              { name: 'Category', value: ticket.category || 'Uncategorized', inline: true },
              { name: 'Ticket owner', value: `<@${ticket.discord_id}>`, inline: true },
              { name: 'Staff member', value: actorId ? `<@${actorId}>` : 'Automatic', inline: true },
              ...(ticket.claimed_by ? [{ name: 'Claimed by', value: `<@${ticket.claimed_by}>`, inline: true }] : []),
              ...(detail ? [{ name: 'Details', value: String(detail).slice(0, 1000), inline: false }] : [])
            ]
          })],
          ...(file ? { files: [file] } : {}),
          allowedMentions: { parse: [] }
        });
        return true;
      } catch (err) {
        logger.error({ err, ticketNumber: ticket.number, action, logId }, 'failed to deliver ticket log');
        return false;
      }
    },
    async close(ticket, guild, actorId) {
      let channel;
      try {
        channel = await guild.channels.fetch(ticket.channel_id);
      } catch (err) {
        logger.warn({ err, ticketNumber: ticket.number, channelId: ticket.channel_id }, 'ticket channel unavailable while creating transcript');
        throw err;
      }
      const messages = [];
      if (channel) {
        let last;
        while (true) {
          const batch = await channel.messages.fetch({ limit: 100, before: last });
          if (!batch.size) break;
          for (const m of batch.values()) messages.push(m);
          last = batch.last()?.id;
          if (!last) break;
          if (batch.size < 100) break;
        }
      }
      messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      const transcriptMessages = messages.map((message) => {
        const attachments = [...message.attachments.values()]
          .map((attachment) => `<a href="${htmlEscape(attachment.url)}">${htmlEscape(attachment.name || 'Attachment')}</a>`)
          .join(' ');
        const embeds = message.embeds
          .map((messageEmbed) => htmlEscape(messageEmbed.description || messageEmbed.title || 'Embedded content'))
          .join('<br>');
        const body = htmlEscape(message.content).replace(/\r?\n/g, '<br>');
        return `<article><b>${htmlEscape(message.author.tag)}</b> ${new Date(message.createdTimestamp).toISOString()}<p>${body || ' '}</p>${embeds ? `<p>${embeds}</p>` : ''}${attachments ? `<p>${attachments}</p>` : ''}</article>`;
      }).join('\n');
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Ticket ${ticket.number}</title></head><body>
        <h1>Ticket #${ticket.number}</h1>
        <p>User: ${htmlEscape(ticket.discord_id)} | Minecraft: ${htmlEscape(ticket.mc_name || 'Not provided')} | Category: ${htmlEscape(ticket.category)}</p>
        <p>Claimed by: ${htmlEscape(ticket.claimed_by || 'Unclaimed')} | Created: ${htmlEscape(ticket.created_at)}</p>
        <hr>${transcriptMessages || '<p>No messages were available for this ticket.</p>'}
      </body></html>`;
      const dir = path.resolve('./data/transcripts');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `ticket-${ticket.number}.html`);
      fs.writeFileSync(file, html);
      const updated = db.raw.prepare("UPDATE tickets SET status = 'closed', closed_at = datetime('now') WHERE id = ? AND status = 'open'").run(ticket.id);
      if (!updated.changes) return { file, logDelivered: false, alreadyClosed: true };

      const logDelivered = await this.logEvent(ticket, 'closed · transcript', actorId, { file });
      try {
        const user = await client.users.fetch(ticket.discord_id);
        await user.send({ content: `Your ticket #${ticket.number} was closed.`, files: [file] });
      } catch (err) {
        logger.warn({ err, ticketNumber: ticket.number, discordId: ticket.discord_id }, 'failed to deliver ticket transcript to its owner');
      }
      if (channel) {
        await channel.delete('Ticket closed').catch((err) => {
          logger.error({ err, ticketNumber: ticket.number, channelId: channel.id }, 'failed to delete closed ticket channel');
        });
      }
      return { file, logDelivered, alreadyClosed: false };
    },
    async remove(ticket, guild, actorId) {
      if (ticket.status === 'open') {
        await this.close(ticket, guild, actorId);
      } else if (ticket.channel_id) {
        let channel;
        try {
          channel = await guild.channels.fetch(ticket.channel_id);
        } catch (err) {
          if (err.code !== 10003) throw err;
        }
        if (channel) await channel.delete(`Ticket #${ticket.number} removed by staff`);
      }
      const result = db.raw.prepare(
        "UPDATE tickets SET status = 'deleted' WHERE id = ? AND status IN ('open', 'closed')"
      ).run(ticket.id);
      if (result.changes !== 1) throw new Error('TICKET_REMOVE_CONFLICT');
      return { ...ticket, status: 'deleted' };
    },
    async closeIdle() {
      const hours = cfg(db, 'idle_ticket_hours');
      const rows = db.raw.prepare(`SELECT * FROM tickets WHERE status = 'open' AND datetime(last_activity_at) <= datetime('now', ?)`).all(`-${hours} hours`);
      const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
      for (const ticket of rows) {
        try {
          await this.close(ticket, guild);
        } catch (err) {
          logger.error({ err, ticketNumber: ticket.number }, 'failed to close idle ticket');
        }
      }
    },
    list(status = 'open', category) {
      if (!['open', 'closed'].includes(status)) throw new Error('TICKET_STATUS_INVALID');
      if (category) {
        return db.raw.prepare('SELECT * FROM tickets WHERE status = ? AND category = ? ORDER BY number DESC LIMIT 25').all(status, category);
      }
      return db.raw.prepare('SELECT * FROM tickets WHERE status = ? ORDER BY number DESC LIMIT 25').all(status);
    }
  };
}

module.exports = { createTicketService };
