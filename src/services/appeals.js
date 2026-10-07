const { PermissionFlagsBits, ChannelType, OverwriteType } = require('discord.js');
const { cfg } = require('../config/store');
const { logger } = require('../logger');

const APPEALABLE_TYPES = new Set(['ban', 'tempban', 'mute', 'tempmute']);

function createAppealsService(ctx) {
  const { db } = ctx;
  const openings = new Map();

  function getAppeal(appealId) {
    return db.raw.prepare('SELECT * FROM appeals WHERE id = ?').get(appealId);
  }

  async function openAppeal({ guild, user, caseId, username, explanation }) {
    const normalizedUsername = String(username || '').trim();
    let normalizedCaseId = String(caseId || '').trim().toUpperCase();
    const text = String(explanation || '').trim();
    if ((!normalizedCaseId && !normalizedUsername) || !text || text.length > 1000) throw new Error('INVALID_APPEAL');

    let punish = normalizedCaseId
      ? ctx.moderation.getActiveByCase(normalizedCaseId)
      : ctx.moderation.getActiveByPlayer(normalizedUsername);
    if (!punish || (punish.expires_at && Number(punish.expires_at) <= Date.now())) throw new Error('NO_CASE');
    normalizedCaseId = punish.case_id;
    if (!APPEALABLE_TYPES.has(punish.type)) throw new Error('NOT_APPEALABLE');

    const linked = db.raw.prepare('SELECT minecraft_uuid, username FROM linked_accounts WHERE discord_id = ?')
      .get(user.id);
    const isPunishmentOwner = punish.target_discord_id === user.id
      || Boolean(linked && (
        (punish.target_uuid && punish.target_uuid === linked.minecraft_uuid)
        || (punish.target_name && punish.target_name.toLowerCase() === linked.username.toLowerCase())
      ));
    if (!isPunishmentOwner) throw new Error('NOT_CASE_OWNER');

    const existing = db.raw.prepare(`SELECT * FROM appeals
      WHERE case_id = ? AND discord_id = ? AND status != 'withdrawn'
      ORDER BY id DESC LIMIT 1`).get(normalizedCaseId, user.id);
    if (existing) {
      if (existing.status !== 'open' && existing.status !== 'resolving') throw new Error('APPEAL_ALREADY_DECIDED');
      const channel = existing.channel_id
        ? await guild.channels.fetch(existing.channel_id).catch((err) => {
          logger.warn({ err, appealId: existing.id }, 'existing appeal channel unavailable');
          return null;
        })
        : null;
      return { channel, id: existing.id, punish, duplicate: true };
    }

    const parent = cfg(db, 'appeal_category_id');
    const staffRoles = [
      'mod_role_id', 'admin_role_id', 'developer_role_id',
      'head_developer_role_id', 'owner_role_id'
    ].map((key) => String(cfg(db, key) || '').trim()).filter(Boolean);
    const info = db.raw.prepare(`INSERT INTO appeals (case_id, discord_id, explanation, status)
      VALUES (?, ?, ?, 'open')`).run(normalizedCaseId, user.id, text);
    const id = Number(info.lastInsertRowid);

    try {
      const overwrites = [
        { id: guild.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, type: OverwriteType.Member, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ...staffRoles.map((roleId) => ({
          id: roleId,
          type: OverwriteType.Role,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        }))
      ];
      const channel = await guild.channels.create({
        name: `appeal-${String(id).padStart(5, '0')}`,
        type: ChannelType.GuildText,
        parent: parent || undefined,
        topic: `Appeal #${id} for case ${normalizedCaseId}`,
        permissionOverwrites: overwrites
      });
      db.raw.prepare("UPDATE appeals SET channel_id = ?, updated_at = datetime('now') WHERE id = ?")
        .run(channel.id, id);
      return { channel, id, punish, duplicate: false };
    } catch (err) {
      db.raw.prepare('DELETE FROM appeals WHERE id = ? AND status = ?').run(id, 'open');
      throw err;
    }
  }

  async function open(input) {
    const targetCaseId = String(input.caseId || '').trim().toUpperCase()
      || ctx.moderation.getActiveByPlayer(input.username)?.case_id
      || '';
    const key = `${input.user.id}:${targetCaseId || String(input.username || '').trim().toLowerCase()}`;
    const pending = openings.get(key);
    if (pending) {
      await pending.catch(() => {});
      const resolvedCaseId = targetCaseId || ctx.moderation.getActiveByPlayer(input.username)?.case_id;
      if (!resolvedCaseId) return openAppeal(input);
      const duplicate = db.raw.prepare(`SELECT * FROM appeals
        WHERE case_id = ? AND discord_id = ? AND status != 'withdrawn'
        ORDER BY id DESC LIMIT 1`).get(resolvedCaseId, input.user.id);
      if (duplicate) {
        const channel = duplicate.channel_id ? await input.guild.channels.fetch(duplicate.channel_id).catch(() => null) : null;
        return { channel, id: duplicate.id, punish: ctx.moderation.getActiveByCase(duplicate.case_id), duplicate: true };
      }
    }
    const operation = openAppeal(input);
    openings.set(key, operation);
    try {
      return await operation;
    } finally {
      if (openings.get(key) === operation) openings.delete(key);
    }
  }

  function getByChannel(channelId) {
    return db.raw.prepare('SELECT * FROM appeals WHERE channel_id = ?').get(channelId);
  }

  function getOwned(appealId, discordId) {
    return db.raw.prepare('SELECT * FROM appeals WHERE id = ? AND discord_id = ?').get(appealId, discordId);
  }

  function getStatus(appealId, discordId) {
    const appeal = getOwned(appealId, discordId);
    if (!appeal) throw new Error('APPEAL_NOT_FOUND');
    return { ...appeal, accept_count: JSON.parse(appeal.accept_votes).length, deny_count: JSON.parse(appeal.deny_votes).length };
  }

  function listOwned(discordId, limit = 10) {
    return db.raw.prepare(`SELECT * FROM appeals WHERE discord_id = ?
      ORDER BY id DESC LIMIT ?`).all(discordId, limit);
  }

  function list(status, limit = 20) {
    const normalizedStatus = status === 'pending' ? 'open'
      : status === 'approved' ? 'accepted'
        : status;
    if (status === 'pending') {
      return db.raw.prepare(`SELECT * FROM appeals WHERE status IN ('open', 'resolving')
        ORDER BY updated_at DESC, id DESC LIMIT ?`).all(limit);
    }
    const rows = normalizedStatus
      ? db.raw.prepare(`SELECT * FROM appeals WHERE status = ? ORDER BY updated_at DESC, id DESC LIMIT ?`)
        .all(normalizedStatus, limit)
      : db.raw.prepare('SELECT * FROM appeals ORDER BY updated_at DESC, id DESC LIMIT ?').all(limit);
    return rows;
  }

  function getDetails(appealId) {
    const appeal = getAppeal(appealId);
    if (!appeal) return null;
    const punishment = db.raw.prepare('SELECT * FROM punishments WHERE case_id = ? ORDER BY id DESC LIMIT 1')
      .get(appeal.case_id);
    const staff = db.raw.prepare('SELECT actor_discord_id FROM staff_log WHERE case_id = ? ORDER BY id ASC LIMIT 1')
      .get(appeal.case_id);
    const notes = db.raw.prepare('SELECT * FROM appeal_staff_notes WHERE appeal_id = ? ORDER BY id DESC LIMIT 10')
      .all(appealId);
    return { appeal, punishment, staff, notes };
  }

  async function addMessage(appealId, discordId, message, guild) {
    const text = String(message || '').trim();
    if (!text || text.length > 1000) throw new Error('INVALID_APPEAL_MESSAGE');
    const appeal = getOwned(appealId, discordId);
    if (!appeal) throw new Error('APPEAL_NOT_FOUND');
    if (appeal.status !== 'open') throw new Error('APPEAL_CLOSED');
    if (!appeal.channel_id) throw new Error('APPEAL_CHANNEL_MISSING');
    const channel = await guild.channels.fetch(appeal.channel_id);
    await channel.send({ content: `**Additional information from <@${discordId}>:**\n${text}`, allowedMentions: { parse: [] } });
    db.raw.prepare("UPDATE appeals SET updated_at = datetime('now') WHERE id = ? AND status = 'open'").run(appealId);
    return appeal;
  }

  function addStaffNote(appealId, staffId, note) {
    const text = String(note || '').trim();
    if (!text || text.length > 1000) throw new Error('INVALID_APPEAL_NOTE');
    const appeal = getAppeal(appealId);
    if (!appeal) throw new Error('APPEAL_NOT_FOUND');
    db.raw.prepare('INSERT INTO appeal_staff_notes (appeal_id, staff_id, note) VALUES (?, ?, ?)')
      .run(appealId, staffId, text);
    db.raw.prepare("UPDATE appeals SET updated_at = datetime('now') WHERE id = ?").run(appealId);
    ctx.staffLog.add({
      actorId: staffId,
      targetDiscordId: appeal.discord_id,
      action: 'appeal_note',
      reason: `Private note added to appeal #${appealId}`,
      result: 'stored privately',
      caseId: appeal.case_id,
      metadata: { appealId }
    });
  }

  function assign(appealId, staffId, assigneeId) {
    const appeal = getAppeal(appealId);
    if (!appeal) throw new Error('APPEAL_NOT_FOUND');
    if (!['open', 'resolving'].includes(appeal.status)) throw new Error('APPEAL_CLOSED');
    db.raw.prepare("UPDATE appeals SET assigned_to = ?, updated_at = datetime('now') WHERE id = ?")
      .run(assigneeId || null, appealId);
    ctx.staffLog.add({
      actorId: staffId,
      targetDiscordId: appeal.discord_id,
      action: 'appeal_assign',
      reason: `Appeal #${appealId} assigned to ${assigneeId || 'unassigned'}`,
      result: 'assignment updated',
      caseId: appeal.case_id,
      metadata: { appealId, assigneeId: assigneeId || null }
    });
    return { ...appeal, assigned_to: assigneeId || null };
  }

  async function close(appealId, staffId, guild) {
    const appeal = getAppeal(appealId);
    if (!appeal) throw new Error('APPEAL_NOT_FOUND');
    if (!['open', 'resolving'].includes(appeal.status)) throw new Error('APPEAL_CLOSED');
    const updated = db.raw.prepare(`UPDATE appeals SET status = 'closed', decision_reason = 'Closed by staff',
      updated_at = datetime('now') WHERE id = ? AND status IN ('open', 'resolving')`).run(appealId);
    if (!updated.changes) throw new Error('APPEAL_CLOSED');
    ctx.staffLog.add({
      actorId: staffId,
      targetDiscordId: appeal.discord_id,
      action: 'appeal_close',
      reason: `Appeal #${appealId} closed by staff`,
      result: 'closed and archived',
      caseId: appeal.case_id,
      metadata: { appealId }
    });
    if (appeal.channel_id) {
      const channel = await guild.channels.fetch(appeal.channel_id);
      await channel.permissionOverwrites.edit(appeal.discord_id, { SendMessages: false });
      await channel.setTopic(`Appeal #${appeal.id} closed · Case ${appeal.case_id}`);
      await channel.send({ content: `Appeal #${appeal.id} was closed by <@${staffId}>.`, allowedMentions: { parse: [] } });
    }
    return appeal;
  }

  function history(username) {
    const name = String(username || '').trim();
    if (!name) throw new Error('INVALID_PLAYER_NAME');
    const punishments = db.raw.prepare(`SELECT p.*,
        (SELECT actor_discord_id FROM staff_log s WHERE s.case_id = p.case_id ORDER BY s.id ASC LIMIT 1) AS actor_discord_id
      FROM punishments p WHERE p.target_name = ? COLLATE NOCASE ORDER BY p.id DESC LIMIT 20`).all(name);
    const appeals = db.raw.prepare(`SELECT * FROM appeals WHERE case_id IN
      (SELECT case_id FROM punishments WHERE target_name = ? COLLATE NOCASE)
      ORDER BY id DESC LIMIT 20`).all(name);
    return { punishments, appeals };
  }

  async function withdraw(appealId, discordId, guild) {
    const appeal = getOwned(appealId, discordId);
    if (!appeal) throw new Error('APPEAL_NOT_FOUND');
    if (appeal.status !== 'open') throw new Error('APPEAL_CLOSED');
    const updated = db.raw.prepare(`UPDATE appeals SET status = 'withdrawn', updated_at = datetime('now')
      WHERE id = ? AND discord_id = ? AND status = 'open'`).run(appealId, discordId);
    if (!updated.changes) throw new Error('APPEAL_CLOSED');
    if (appeal.channel_id) {
      const channel = await guild.channels.fetch(appeal.channel_id).catch((err) => {
        logger.warn({ err, appealId }, 'withdrawn appeal channel unavailable');
        return null;
      });
      if (channel) {
        await channel.setTopic(`Appeal #${appealId} withdrawn`).catch((err) => {
          logger.warn({ err, appealId }, 'failed to mark withdrawn appeal channel');
        });
        await channel.send({ content: `Appeal #${appealId} was withdrawn by its requester.` });
      }
    }
    return appeal;
  }

  async function vote(appealId, staffId, accept, decisionReason, guild) {
    const reason = String(decisionReason || '').trim();
    if (reason.length < 10 || reason.length > 1000) throw new Error('INVALID_DECISION_REASON');

    const result = db.raw.transaction(() => {
      const appeal = getAppeal(appealId);
      if (!appeal || appeal.status !== 'open') throw new Error('CLOSED');
      if (accept && appeal.decision_action && appeal.decision_action !== 'lift') throw new Error('DECISION_ACTION_MISMATCH');

      const acceptVotes = new Set(JSON.parse(appeal.accept_votes));
      const denyVotes = new Set(JSON.parse(appeal.deny_votes));
      acceptVotes.delete(staffId);
      denyVotes.delete(staffId);
      if (accept) acceptVotes.add(staffId);
      else denyVotes.add(staffId);

      const configuredVotes = Number(cfg(db, 'appeal_min_votes'));
      const requiredVotes = Number.isSafeInteger(configuredVotes) && configuredVotes > 0 ? configuredVotes : 2;
      const decision = acceptVotes.size >= requiredVotes ? 'accepted'
        : denyVotes.size >= requiredVotes ? 'denied' : 'pending';
      const nextStatus = decision === 'accepted' ? 'resolving'
        : decision === 'denied' ? 'denied' : 'open';

      const updated = db.raw.prepare(`UPDATE appeals
            SET accept_votes = ?, deny_votes = ?, decision_reason = ?, decision_action = ?, status = ?,
            updated_at = datetime('now')
        WHERE id = ? AND status = 'open'`)
            .run(JSON.stringify([...acceptVotes]), JSON.stringify([...denyVotes]), reason, appeal.decision_action || 'lift', nextStatus, appealId);
      if (!updated.changes) throw new Error('CLOSED');
      return { appeal, decision, acceptCount: acceptVotes.size, denyCount: denyVotes.size, requiredVotes };
    })();

    ctx.staffLog.add({
      actorId: staffId,
      targetDiscordId: result.appeal.discord_id,
      action: `appeal_vote_${accept ? 'accept' : 'deny'}`,
      reason: reason,
      result: `${result.acceptCount} accept / ${result.denyCount} deny`,
      caseId: result.appeal.case_id,
      metadata: { appealId, requiredVotes: result.requiredVotes, decision: result.decision }
    });

    if (result.decision === 'accepted') {
      try {
        await ctx.moderation.liftByCase(guild, result.appeal.case_id);
      } catch (err) {
        db.raw.prepare("UPDATE appeals SET status = 'open', updated_at = datetime('now') WHERE id = ? AND status = 'resolving'")
          .run(appealId);
        throw err;
      }
      db.raw.prepare("UPDATE appeals SET status = 'accepted', updated_at = datetime('now') WHERE id = ? AND status = 'resolving'")
        .run(appealId);
    }

    if (result.decision !== 'pending') {
      ctx.staffLog.add({
        actorId: staffId,
        targetDiscordId: result.appeal.discord_id,
        action: `appeal_${result.decision}`,
        reason: `${result.appeal.explanation}\nDecision: ${reason}`,
        result: `${result.decision} (${result.acceptCount} accept / ${result.denyCount} deny)`,
        caseId: result.appeal.case_id,
        metadata: { appealId, requiredVotes: result.requiredVotes }
      });
    }

    return {
      status: result.decision,
      acceptCount: result.acceptCount,
      denyCount: result.denyCount,
      requiredVotes: result.requiredVotes
    };
  }

  async function voteReduction(appealId, staffId, duration, decisionReason) {
    const reason = String(decisionReason || '').trim();
    const requestedDuration = String(duration || '').trim();
    if (reason.length < 10 || reason.length > 1000) throw new Error('INVALID_DECISION_REASON');
    if (!requestedDuration) throw new Error('INVALID_REDUCED_DURATION');

    const result = db.raw.transaction(() => {
      const appeal = getAppeal(appealId);
      if (!appeal || appeal.status !== 'open') throw new Error('CLOSED');
      if (appeal.decision_action && appeal.decision_action !== 'reduce') throw new Error('DECISION_ACTION_MISMATCH');
      if (appeal.decision_duration && appeal.decision_duration !== requestedDuration) throw new Error('REDUCTION_DURATION_MISMATCH');

      const acceptVotes = new Set(JSON.parse(appeal.accept_votes));
      const denyVotes = new Set(JSON.parse(appeal.deny_votes));
      acceptVotes.delete(staffId);
      denyVotes.delete(staffId);
      acceptVotes.add(staffId);
      const configuredVotes = Number(cfg(db, 'appeal_min_votes'));
      const requiredVotes = Number.isSafeInteger(configuredVotes) && configuredVotes > 0 ? configuredVotes : 2;
      const decision = acceptVotes.size >= requiredVotes ? 'reduced'
        : denyVotes.size >= requiredVotes ? 'denied' : 'pending';
      const nextStatus = decision === 'reduced' ? 'resolving'
        : decision === 'denied' ? 'denied' : 'open';
      const updated = db.raw.prepare(`UPDATE appeals
        SET accept_votes = ?, deny_votes = ?, decision_reason = ?, decision_action = 'reduce',
            decision_duration = ?, status = ?, updated_at = datetime('now')
        WHERE id = ? AND status = 'open'`)
        .run(JSON.stringify([...acceptVotes]), JSON.stringify([...denyVotes]), reason, requestedDuration, nextStatus, appealId);
      if (!updated.changes) throw new Error('CLOSED');
      return { appeal, decision, acceptCount: acceptVotes.size, denyCount: denyVotes.size, requiredVotes };
    })();

    ctx.staffLog.add({
      actorId: staffId,
      targetDiscordId: result.appeal.discord_id,
      action: 'appeal_vote_reduce',
      reason,
      result: `${result.acceptCount} reduce / ${result.denyCount} deny; requested ${requestedDuration}`,
      caseId: result.appeal.case_id,
      metadata: { appealId, requiredVotes: result.requiredVotes, decision: result.decision, duration: requestedDuration }
    });

    if (result.decision === 'reduced') {
      try {
        await ctx.moderation.reduceTemporaryBan(result.appeal.case_id, requestedDuration, reason);
      } catch (err) {
        db.raw.prepare("UPDATE appeals SET status = 'open', updated_at = datetime('now') WHERE id = ? AND status = 'resolving'")
          .run(appealId);
        throw err;
      }
      db.raw.prepare("UPDATE appeals SET status = 'accepted', updated_at = datetime('now') WHERE id = ? AND status = 'resolving'")
        .run(appealId);
    } else if (result.decision === 'denied') {
      db.raw.prepare("UPDATE appeals SET decision_action = 'reduce', decision_duration = ?, updated_at = datetime('now') WHERE id = ?")
        .run(requestedDuration, appealId);
    }

    if (result.decision !== 'pending') {
      ctx.staffLog.add({
        actorId: staffId,
        targetDiscordId: result.appeal.discord_id,
        action: `appeal_${result.decision}`,
        reason: `${result.appeal.explanation}\nDecision: ${reason}`,
        result: `${result.decision} (${result.acceptCount} reduce / ${result.denyCount} deny)`,
        caseId: result.appeal.case_id,
        metadata: { appealId, requiredVotes: result.requiredVotes, duration: requestedDuration }
      });
    }

    return {
      status: result.decision,
      acceptCount: result.acceptCount,
      denyCount: result.denyCount,
      requiredVotes: result.requiredVotes,
      duration: requestedDuration
    };
  }

  return {
    open,
    getByChannel,
    getOwned,
    getStatus,
    listOwned,
    list,
    getDetails,
    addMessage,
    addStaffNote,
    assign,
    close,
    history,
    withdraw,
    vote,
    voteReduction
  };
}

module.exports = { createAppealsService, APPEALABLE_TYPES };
