const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { embed } = require('../../util/embeds');
const { ticketCategories } = require('../../services/ticketCategories');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticketqueue')
    .setDescription('List, filter, or remove support and recruitment tickets')
    .addStringOption((option) => option
      .setName('action')
      .setDescription('List tickets or remove one')
      .addChoices(
        { name: 'List tickets', value: 'list' },
        { name: 'Remove ticket', value: 'remove' }
      ))
    .addStringOption((option) => option
      .setName('status')
      .setDescription('Show active or closed tickets')
      .addChoices(
        { name: 'Active', value: 'open' },
        { name: 'Closed', value: 'closed' }
      ))
    .addStringOption((option) => option
      .setName('category')
      .setDescription('Filter by ticket category')
      .addChoices(...Object.entries(ticketCategories).map(([value, category]) => ({
        name: category.label,
        value
      }))))
    .addIntegerOption((option) => option
      .setName('number')
      .setDescription('Ticket number to remove')
      .setMinValue(1))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  staff: 'helper',
  async execute(interaction, ctx) {
    const action = interaction.options.getString('action') || 'list';
    const status = interaction.options.getString('status') || 'open';
    const categoryKey = interaction.options.getString('category');
    const category = categoryKey ? ticketCategories[categoryKey].label : null;
    if (action === 'remove') {
      const number = interaction.options.getInteger('number');
      if (!number) {
        await interaction.reply({ content: 'Choose the ticket number to remove.', ephemeral: true });
        return;
      }
      const ticket = ctx.tickets.getByNumber(number);
      if (!ticket || ticket.status === 'deleted') {
        await interaction.reply({ content: `Ticket #${number} was not found.`, ephemeral: true });
        return;
      }
      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket_remove_confirm:${number}:${interaction.user.id}`)
          .setLabel('Remove ticket')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`ticket_remove_cancel:${number}:${interaction.user.id}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );
      await interaction.reply({
        ephemeral: true,
        content: `Remove ticket #${number} from the queue?${ticket.status === 'open' ? ' Its channel will be closed, a transcript will be saved and sent, then it will be removed from the queue.' : ' Its record will be hidden from the queue.'}`,
        components: [buttons]
      });
      return;
    }

    const tickets = ctx.tickets.list(status, category);
    const shownTickets = tickets.slice(0, 10);
    const statusLabel = status === 'open' ? 'Active' : 'Closed';
    const title = category ? `${statusLabel} tickets · ${category}` : `${statusLabel} ticket queue`;
    const description = shownTickets.map((ticket) => {
      const createdAt = Date.parse(`${String(ticket.created_at).replace(' ', 'T')}Z`);
      const opened = Number.isNaN(createdAt) ? ticket.created_at : `<t:${Math.floor(createdAt / 1000)}:R>`;
      const owner = `<@${ticket.discord_id}>`;
      const claimed = ticket.claimed_by ? `<@${ticket.claimed_by}>` : 'Unclaimed';
      return `**#${ticket.number} · ${ticket.category}**\n<#${ticket.channel_id}> · ${opened} · ${owner} · ${claimed}`;
    }).join('\n\n');
    const more = tickets.length > shownTickets.length
      ? `\n\nShowing ${shownTickets.length} of ${tickets.length} recent matching tickets.`
      : '';
    await interaction.reply({
      ephemeral: true,
      allowedMentions: { parse: [] },
      embeds: [embed(ctx.db, {
        title,
        description: `${description || `No ${statusLabel.toLowerCase()} tickets match this filter.`}${more}`
      })]
    });
  }
};
