const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { ticketModal, ticketCategoryMenu, addUserModal } = require('../commands/tickets');
const { appealDecisionModal } = require('../commands/staff/moderation');
const { getTicketCategory } = require('../services/ticketCategories');
const { configModal } = require('../commands/community');
const { _test: helpPagination } = require('../commands/help');
const { sendRcon } = require('../services/rcon');
const { t } = require('../i18n');
const { isStaff, requireTier } = require('../util/staff');
const { embed } = require('../util/embeds');
const { logger } = require('../logger');

async function handleInteraction(interaction, ctx) {
  if (interaction.isButton() && interaction.customId.startsWith('help:')) {
    const match = interaction.customId.match(/^help:(all|player|staff|server|tickets|community):(\d+)$/);
    if (!match) {
      await interaction.reply({ content: 'This help page control is invalid. Run `/help` again.', ephemeral: true });
      return;
    }
    const [, category, rawPage] = match;
    if (category === 'staff' && !isStaff(interaction.member, ctx.db)) {
      await interaction.reply({
        content: 'Staff tools are only available to members with a configured staff role.',
        ephemeral: true
      });
      return;
    }
    await interaction.update(helpPagination.createHelpPayload(
      ctx,
      category,
      Number(rawPage)
    ));
    return;
  }
  if (interaction.isButton() && interaction.customId === 'ticket_open') {
    await interaction.reply({
      content: 'Choose the category that best matches your request.',
      components: [ticketCategoryMenu()],
      ephemeral: true
    });
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('ticket_remove_')) {
    const match = interaction.customId.match(/^ticket_remove_(confirm|cancel):(\d+):(\d{17,20})$/);
    if (!match) {
      await interaction.reply({ content: 'This ticket removal request is invalid or expired.', ephemeral: true });
      return;
    }
    const [, action, number, requesterId] = match;
    if (requesterId !== interaction.user.id || !isStaff(interaction.member, ctx.db)) {
      await interaction.reply({ content: t(ctx.db, 'generic.no_permission'), ephemeral: true });
      return;
    }
    if (action === 'cancel') {
      await interaction.update({ content: 'Ticket removal cancelled.', components: [] });
      return;
    }
    const ticket = ctx.tickets.getByNumber(Number(number));
    if (!ticket || ticket.status === 'deleted') {
      await interaction.update({ content: `Ticket #${number} is already removed or no longer exists.`, components: [] });
      return;
    }
    await interaction.deferUpdate();
    const result = await ctx.tickets.remove(ticket, interaction.guild, interaction.user.id);
    ctx.staffLog.add({
      actorId: interaction.user.id,
      action: 'ticket_remove',
      reason: `#${number}`,
      result: 'removed from ticket queue',
      metadata: { category: ticket.category, previousStatus: ticket.status }
    });
    await ctx.tickets.logEvent(result, 'removed from queue', interaction.user.id);
    await interaction.editReply({ content: `Ticket #${number} was removed from the queue.`, components: [] });
    return;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category') {
    await interaction.showModal(ticketModal(interaction.values[0]));
    return;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal:')) {
    try {
      const categoryKey = interaction.customId.slice('ticket_modal:'.length);
      const category = getTicketCategory(categoryKey);
      if (!category) {
        await interaction.reply({ content: 'That ticket category is no longer available. Please open a new ticket.', ephemeral: true });
        return;
      }
      const values = Object.fromEntries(category.fields.map((field) => [
        field.id,
        interaction.fields.getTextInputValue(field.id).trim()
      ]));
      const summary = category.fields
        .filter((field) => values[field.id])
        .map((field) => `**${field.label}:** ${values[field.id]}`)
        .join('\n');
      const { channel, number, duplicate } = await ctx.tickets.open({
        guild: interaction.guild,
        user: interaction.user,
        category: category.label,
        reason: summary,
        mcName: values.minecraft_name || null,
        submissionId: interaction.id
      });
      if (duplicate) {
        await interaction.reply({
          content: channel
            ? `You already opened this ticket: ${channel}`
            : `Ticket #${number} was already created, but its channel is unavailable. Please contact staff.`,
          ephemeral: true
        });
        return;
      }
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('ticket_adduser').setLabel('Add user').setStyle(ButtonStyle.Secondary)
      );
      await channel.send({
        content: `<@${interaction.user.id}>`,
        embeds: [embed(ctx.db, {
          title: `Ticket #${number} · ${category.label}`,
          description: summary.slice(0, 4000)
        })],
        components: [row]
      });
      const ticket = ctx.tickets.getByChannel(channel.id);
      ctx.staffLog.add({
        actorId: interaction.user.id,
        action: 'ticket_open',
        reason: `#${number}`,
        result: channel.id,
        metadata: { category: categoryKey, fields: values }
      });
      const logged = await ctx.tickets.logEvent(ticket, 'opened', interaction.user.id, { detail: summary });
      await interaction.reply({
        content: `Opened ${channel}.${logged ? '' : ' The bot could not post to the ticket log channel; an administrator should check its configuration and permissions.'}`,
        ephemeral: true
      });
    } catch (err) {
      if (err.message === 'TICKET_LIMIT') {
        await interaction.reply({ content: t(ctx.db, 'ticket.limit'), ephemeral: true });
        return;
      }
      throw err;
    }
    return;
  }
  if (interaction.isButton() && ['ticket_claim', 'ticket_close', 'ticket_adduser'].includes(interaction.customId)) {
    if (!isStaff(interaction.member, ctx.db)) {
      await interaction.reply({ content: t(ctx.db, 'generic.no_permission'), ephemeral: true });
      return;
    }
    const ticket = ctx.tickets.getByChannel(interaction.channel.id);
    if (!ticket) {
      await interaction.reply({ content: 'Not a ticket channel.', ephemeral: true });
      return;
    }
    if (interaction.customId === 'ticket_claim') {
      ctx.tickets.claim(ticket.id, interaction.user.id);
      ctx.staffLog.add({
        actorId: interaction.user.id,
        action: 'ticket_claim',
        reason: `#${ticket.number}`,
        result: 'claimed',
        metadata: { category: ticket.category }
      });
      const logged = await ctx.tickets.logEvent(ticket, 'claimed', interaction.user.id);
      const content = `Claimed by <@${interaction.user.id}>${logged ? '' : ' (ticket log delivery failed)'}`;
      await interaction.reply({ content });
      return;
    }
    if (interaction.customId === 'ticket_close') {
      await interaction.deferReply({ ephemeral: true });
      const result = await ctx.tickets.close(ticket, interaction.guild, interaction.user.id);
      ctx.staffLog.add({ actorId: interaction.user.id, action: 'ticket_close', reason: `#${ticket.number}`, result: 'closed' });
      await interaction.editReply({
        content: `Ticket #${ticket.number} closed.${result.logDelivered ? '' : ' Transcript could not be delivered to the ticket log channel; check its configuration and bot permissions.'}`
      });
      return;
    }
    await interaction.showModal(addUserModal());
    return;
  }
  if (interaction.isModalSubmit() && interaction.customId === 'ticket_adduser_modal') {
    if (!isStaff(interaction.member, ctx.db)) {
      await interaction.reply({ content: t(ctx.db, 'generic.no_permission'), ephemeral: true });
      return;
    }
    const ticket = ctx.tickets.getByChannel(interaction.channel.id);
    if (!ticket) {
      await interaction.reply({ content: 'Not a ticket channel.', ephemeral: true });
      return;
    }
    const userId = interaction.fields.getTextInputValue('discord_user_id').trim();
    if (!/^\d{17,20}$/.test(userId)) {
      await interaction.reply({ content: 'Enter a valid Discord user ID (17-20 digits).', ephemeral: true });
      return;
    }
    let member;
    try {
      member = await interaction.guild.members.fetch(userId);
    } catch (err) {
      if (err.code !== 10007) throw err;
    }
    if (!member) {
      await interaction.reply({ content: 'That user is not a member of this server.', ephemeral: true });
      return;
    }
    await ctx.tickets.addUser(ticket, interaction.guild, member.id);
    ctx.staffLog.add({
      actorId: interaction.user.id,
      targetDiscordId: member.id,
      action: 'ticket_add_user',
      reason: `#${ticket.number}`,
      result: 'added'
    });
    const logged = await ctx.tickets.logEvent(ticket, 'participant added', interaction.user.id, { detail: `<@${member.id}>` });
    await interaction.reply({
      content: `Added <@${member.id}> to ticket #${ticket.number}.${logged ? '' : ' (ticket log delivery failed)'}`,
      ephemeral: true
    });
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('wl_')) {
    if (!requireTier(interaction.member, ctx.db, 'mod')) {
      await interaction.reply({ content: t(ctx.db, 'generic.no_permission'), ephemeral: true });
      return;
    }
    const [kind, id] = interaction.customId.split(':');
    const approve = kind === 'wl_approve';
    await ctx.whitelist.decide(ctx, Number(id), approve, interaction.user.id, interaction.guild);
    await interaction.update({ content: approve ? 'Approved.' : 'Denied.', components: [] });
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('rcon_confirm:')) {
    if (!isStaff(interaction.member, ctx.db)) return;
    const payload = JSON.parse(Buffer.from(interaction.customId.split(':')[1], 'base64url').toString('utf8'));
    const server = ctx.db.servers.get(payload.s);
    const { result } = await sendRcon(ctx.env, ctx.db, server, payload.c);
    ctx.staffLog.add({ actorId: interaction.user.id, action: 'rcon', reason: payload.c, result, targetName: server.name });
    await interaction.update({ content: `Ran. \`\`\`\n${result || '(empty)'}\n\`\`\``, components: [] });
    return;
  }
  if (interaction.isButton() && /^appeal_(accept|deny):\d+$/.test(interaction.customId)) {
    if (!requireTier(interaction.member, ctx.db, 'mod')) {
      await interaction.reply({ content: t(ctx.db, 'generic.no_permission'), ephemeral: true });
      return;
    }
    const [kind, id] = interaction.customId.split(':');
    const appeal = ctx.appeals.getByChannel(interaction.channel.id);
    if (!appeal || Number(id) !== appeal.id) {
      await interaction.reply({ content: 'This appeal action is invalid or belongs to another channel.', ephemeral: true });
      return;
    }
    await interaction.showModal(appealDecisionModal(appeal.id, kind === 'appeal_accept', interaction.message.id));
    return;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('appeal_decision:')) {
    if (!requireTier(interaction.member, ctx.db, 'mod')) {
      await interaction.reply({ content: t(ctx.db, 'generic.no_permission'), ephemeral: true });
      return;
    }
    const [, rawId, decision, messageId] = interaction.customId.split(':');
    const appealId = Number(rawId);
    const appeal = ctx.appeals.getByChannel(interaction.channel.id);
    if (!Number.isSafeInteger(appealId) || !appeal || appeal.id !== appealId || !['accept', 'deny'].includes(decision)) {
      await interaction.reply({ content: 'This appeal decision is invalid or belongs to another channel.', ephemeral: true });
      return;
    }

    const reason = interaction.fields.getTextInputValue('decision_reason').trim();
    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await ctx.appeals.vote(
        appealId,
        interaction.user.id,
        decision === 'accept',
        reason,
        interaction.guild
      );
      const outcome = result.status === 'accepted' ? 'accepted'
        : result.status === 'denied' ? 'denied' : 'recorded';
      await interaction.editReply({
        content: `Your decision was ${outcome}. Votes: ${result.acceptCount} accept, ${result.denyCount} deny; ${result.requiredVotes} matching votes are required.`
      });

      try {
        const channel = await interaction.guild.channels.fetch(appeal.channel_id);
        await channel.send({
          content: result.status === 'pending'
            ? `Appeal #${appeal.id}: <@${interaction.user.id}> voted **${decision}** (${result.acceptCount} accept / ${result.denyCount} deny; ${result.requiredVotes} matching votes required). Note: ${reason}`
            : `Appeal #${appeal.id} **${result.status}**. Decision note: ${reason}`,
          allowedMentions: { parse: [] }
        });
        if (result.status === 'accepted' || result.status === 'denied') {
          const message = await channel.messages.fetch(messageId);
          await message.edit({ components: [] });
          await channel.setTopic(`Appeal #${appeal.id} ${result.status} · Case ${appeal.case_id}`);
          await channel.permissionOverwrites.edit(appeal.discord_id, { SendMessages: false });
          let dmDelivered = false;
          try {
            const requester = await ctx.client.users.fetch(appeal.discord_id);
            await requester.send(`Your appeal #${appeal.id} for case ${appeal.case_id} was **${result.status}**. Staff note: ${reason}`);
            dmDelivered = true;
          } catch (err) {
            logger.warn({ err, appealId, status: result.status }, 'could not DM appeal requester about decision');
          }
          await interaction.followUp({
            content: `Appeal #${appeal.id} is ${result.status}.${dmDelivered ? ' The requester was notified by DM.' : ' The requester could not be DMed; notify them in the appeal channel.'}`
          });
        }
      } catch (err) {
        logger.error({ err, appealId, status: result.status }, 'appeal decision saved but channel update failed');
        await interaction.followUp({
          content: `Your decision on appeal #${appeal.id} was recorded as ${result.status}, but the appeal channel could not be updated. Please check bot channel permissions.`
        });
      }
    } catch (err) {
      if (err.message === 'CLOSED') {
        await interaction.editReply({ content: 'This appeal has already been decided.' });
        return;
      }
      if (err.message === 'INVALID_DECISION_REASON') {
        await interaction.editReply({ content: 'Decision notes must be between 10 and 1000 characters.' });
        return;
      }
      if (err.message === 'PUNISHMENT_NOT_REVERSIBLE') {
        await interaction.editReply({ content: 'This punishment type cannot be automatically lifted. Contact an administrator to review it manually.' });
        return;
      }
      throw err;
    }
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('giveaway_enter')) {
    const id = Number(interaction.customId.split(':')[1]);
    const g = ctx.db.raw.prepare('SELECT * FROM giveaways WHERE id = ?').get(id);
    if (!g || g.status !== 'open') {
      await interaction.reply({ content: 'Giveaway closed.', ephemeral: true });
      return;
    }
    if (g.require_linked) {
      const linked = ctx.links.getByDiscord(interaction.user.id)[0];
      if (!linked) {
        await interaction.reply({ content: 'Link your account first.', ephemeral: true });
        return;
      }
      if (g.min_playtime_min) {
        try {
          const s = await ctx.stats.forPlayer(linked.username, linked.minecraft_uuid);
          if (s.playtimeMin < g.min_playtime_min) {
            await interaction.reply({ content: 'Not enough playtime.', ephemeral: true });
            return;
          }
        } catch {
          await interaction.reply({ content: 'Could not verify playtime.', ephemeral: true });
          return;
        }
      }
    }
    ctx.events.enter(id, interaction.user.id);
    await interaction.reply({ content: 'Entered.', ephemeral: true });
    return;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'config_select') {
    const key = interaction.values[0];
    const current = ctx.db.config.get(key);
    await interaction.showModal(configModal(key, typeof current === 'string' ? current : JSON.stringify(current)));
    return;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('config_modal:')) {
    const key = interaction.customId.split(':')[1];
    const raw = interaction.fields.getTextInputValue('value');
    let value = raw;
    try { value = JSON.parse(raw); } catch { /* keep string */ }
    ctx.db.config.set(key, value, interaction.user.id);
    ctx.staffLog.add({ actorId: interaction.user.id, action: 'config', reason: key, result: 'updated' });
    await interaction.reply({ content: `Updated \`${key}\`.`, ephemeral: true });
  }
}

module.exports = { handleInteraction };
