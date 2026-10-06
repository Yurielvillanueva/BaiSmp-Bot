const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { embed } = require('../util/embeds');
const { t } = require('../i18n');
const { ticketCategories, getTicketCategory } = require('../services/ticketCategories');

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('ticketpanel')
      .setDescription('Post the ticket panel')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    staff: 'admin', 
    async execute(interaction, ctx) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_open').setLabel('Create a ticket').setStyle(ButtonStyle.Primary)
      );
      await interaction.channel.send({
        embeds: [embed(ctx.db, {
          title: 'Contact staff',
          description: 'Choose a ticket type to send your request to the right team. Tickets are private to you and staff.'
        })],
        components: [row]
      });
      await interaction.reply({ content: 'Panel posted.', ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('whitelist')
      .setDescription('Whitelist applications')
      .addSubcommand((s) => s.setName('apply').setDescription('Apply for whitelist')
        .addStringOption((o) => o.setName('username').setDescription('Minecraft username if not linked'))
        .addStringOption((o) => o.setName('reason').setDescription('Why you want to play')))
      .addSubcommand((s) => s.setName('remove').setDescription('Remove from whitelist')
        .addStringOption((o) => o.setName('username').setDescription('Username').setRequired(true)))
      .addSubcommand((s) => s.setName('list').setDescription('List whitelist'))
      .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
    async execute(interaction, ctx) {
      const sub = interaction.options.getSubcommand();
      if (sub === 'apply') {
        const linked = ctx.links.getByDiscord(interaction.user.id)[0];
        const username = interaction.options.getString('username');
        const reason = interaction.options.getString('reason') || '';
        if (!linked && !username) {
          await interaction.reply({ content: t(ctx.db, 'whitelist.need_link'), ephemeral: true });
          return;
        }
        await interaction.deferReply();
        try {
          const app = await ctx.whitelist.apply({ discordId: interaction.user.id, username, reason, linked });
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`wl_approve:${app.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`wl_deny:${app.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
          );
          await interaction.editReply({
            embeds: [embed(ctx.db, { title: 'Whitelist application', description: `**${app.username}**\n${reason}` })],
            components: [row]
          });
        } catch (err) {
          if (err.message === 'NEED_NAME' || err.message === 'INVALID_NAME') {
            await interaction.editReply({ content: t(ctx.db, 'whitelist.need_link') });
            return;
          }
          throw err;
        }
        return;
      }
      if (!(await ctx.requireStaff(interaction, 'mod'))) return;
      if (sub === 'remove') {
        const username = interaction.options.getString('username', true);
        await interaction.deferReply({ ephemeral: true });
        await ctx.whitelist.remove(username);
        ctx.staffLog.add({ actorId: interaction.user.id, targetName: username, action: 'whitelist_remove', result: 'ok' });
        await interaction.editReply({ content: `Removed ${username}.` });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const list = await ctx.whitelist.list();
      await interaction.editReply({ content: `\`\`\`\n${list.slice(0, 1800)}\n\`\`\`` });
    }
  }
];

function ticketCategoryMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ticket_category')
      .setPlaceholder('Choose a ticket category')
      .addOptions(Object.entries(ticketCategories).map(([value, category]) => ({
        label: category.label,
        description: category.description,
        value
      })))
  );
}

function ticketModal(categoryKey) {
  const category = getTicketCategory(categoryKey);
  if (!category) throw new Error('TICKET_CATEGORY_INVALID');

  return new ModalBuilder()
    .setCustomId(`ticket_modal:${categoryKey}`)
    .setTitle(category.label)
    .addComponents(category.fields.map((field) => new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(field.id)
        .setLabel(field.label)
        .setStyle(field.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(field.required)
        .setMaxLength(field.maxLength)
    )));
}

function addUserModal() {
  return new ModalBuilder()
    .setCustomId('ticket_adduser_modal')
    .setTitle('Add a ticket participant')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('discord_user_id')
        .setLabel('Discord user ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(17)
        .setMaxLength(20)
    ));
}

module.exports.ticketModal = ticketModal;
module.exports.ticketCategoryMenu = ticketCategoryMenu;
module.exports.addUserModal = addUserModal;
