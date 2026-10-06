const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { cfg } = require('../config/store');

function createAppealsService(ctx) {
  const { db } = ctx;

  return {
    async open({ guild, user, caseId, explanation }) {
      const punish = ctx.moderation.getActiveByCase(caseId);
      if (!punish) throw new Error('NO_CASE');
      const parent = cfg(db, 'appeal_category_id');
      const staffRoles = ['mod_role_id', 'admin_role_id', 'owner_role_id'].map((k) => cfg(db, k)).filter(Boolean);
      const overwrites = [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
      ];
      for (const roleId of staffRoles) {
        overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
      }
      const channel = await guild.channels.create({
        name: `appeal-${caseId.slice(-8).toLowerCase()}`,
        type: ChannelType.GuildText,
        parent: parent || undefined,
        permissionOverwrites: overwrites
      });
      const info = db.raw.prepare(`INSERT INTO appeals (case_id, discord_id, channel_id, explanation, status)
        VALUES (?, ?, ?, ?, 'open')`).run(caseId, user.id, channel.id, explanation);
      return { channel, id: info.lastInsertRowid, punish };
    },
    getByChannel(channelId) {
      return db.raw.prepare('SELECT * FROM appeals WHERE channel_id = ?').get(channelId);
    },
    async vote(appealId, staffId, accept, guild) {
      const appeal = db.raw.prepare('SELECT * FROM appeals WHERE id = ?').get(appealId);
      if (!appeal || appeal.status !== 'open') throw new Error('CLOSED');
      const acceptVotes = JSON.parse(appeal.accept_votes);
      const denyVotes = JSON.parse(appeal.deny_votes);
      const a = new Set(acceptVotes);
      const d = new Set(denyVotes);
      a.delete(staffId);
      d.delete(staffId);
      if (accept) a.add(staffId);
      else d.add(staffId);
      db.raw.prepare('UPDATE appeals SET accept_votes = ?, deny_votes = ? WHERE id = ?')
        .run(JSON.stringify([...a]), JSON.stringify([...d]), appealId);
      const need = cfg(db, 'appeal_min_votes');
      if (a.size >= need) {
        await ctx.moderation.liftByCase(guild, appeal.case_id);
        db.raw.prepare("UPDATE appeals SET status = 'accepted' WHERE id = ?").run(appealId);
        ctx.staffLog.add({
          actorId: staffId,
          targetDiscordId: appeal.discord_id,
          action: 'appeal_accept',
          reason: appeal.explanation,
          result: 'accepted',
          caseId: appeal.case_id
        });
        return 'accepted';
      }
      if (d.size >= need) {
        db.raw.prepare("UPDATE appeals SET status = 'denied' WHERE id = ?").run(appealId);
        ctx.staffLog.add({
          actorId: staffId,
          targetDiscordId: appeal.discord_id,
          action: 'appeal_deny',
          reason: appeal.explanation,
          result: 'denied',
          caseId: appeal.case_id
        });
        return 'denied';
      }
      return 'pending';
    }
  };
}

module.exports = { createAppealsService };
