const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { ticketModal, ticketCategoryMenu, addUserModal } = require('../commands/tickets');
const { getTicketCategory } = require('../services/ticketCategories');
const { configModal } = require('../commands/community');
const { sendRcon } = require('../services/rcon');
const { t } = require('../i18n');
const { isStaff, requireTier } = require('../util/staff');
const { embed } = require('../util/embeds');

async function handleInteraction(interaction, ctx) {
  if (interaction.isButton() && interaction.customId === 'ticket_open') {
    await interaction.reply({
      content: 'Choose the category that best matches your request.',
      components: [ticketCategoryMenu()],
      ephemeral: true
    });
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
      const { channel, number } = await ctx.tickets.open({
        guild: interaction.guild,
        user: interaction.user,
        category: category.label,
        reason: summary,
        mcName: values.minecraft_name || null
      });
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
      const logged = await ctx.tickets.logEvent(ticket, 'opened', interaction.user.id);
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
  if (interaction.isButton() && interaction.customId.startsWith('appeal_')) {
    if (!requireTier(interaction.member, ctx.db, 'mod')) {
      await interaction.reply({ content: t(ctx.db, 'generic.no_permission'), ephemeral: true });
      return;
    }
    const accept = interaction.customId.startsWith('appeal_accept');
    const appeal = ctx.appeals.getByChannel(interaction.channel.id);
    const result = await ctx.appeals.vote(appeal.id, interaction.user.id, accept, interaction.guild);
    await interaction.reply({ content: `Vote recorded. Status: ${result}` });
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
