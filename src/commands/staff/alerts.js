const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { EVENT_TYPES, setAlert, listAlerts } = require('../../services/alerts');
const { embed } = require('../../util/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('alerts')
    .setDescription('Configure server event alerts')
    .addSubcommand((s) => s.setName('set').setDescription('Toggle and route an alert')
      .addStringOption((o) => o.setName('event').setDescription('Event type').setRequired(true)
        .addChoices(...EVENT_TYPES.map((e) => ({ name: e, value: e }))))
      .addBooleanOption((o) => o.setName('enabled').setDescription('Enabled').setRequired(true))
      .addChannelOption((o) => o.setName('channel').setDescription('Alert channel'))
      .addStringOption((o) => o.setName('server').setDescription('Server name')))
    .addSubcommand((s) => s.setName('list').setDescription('List alert routing')
      .addStringOption((o) => o.setName('server').setDescription('Server name')))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  staff: 'admin',
  async execute(interaction, ctx) {
    const name = interaction.options.getString('server');
    const server = name ? ctx.db.servers.getByName(name) : ctx.db.servers.all()[0];
    if (!server) {
      await interaction.reply({ content: 'Unknown server.', ephemeral: true });
      return;
    }
    if (interaction.options.getSubcommand() === 'list') {
      const rows = listAlerts(ctx.db, server.id);
      await interaction.reply({
        ephemeral: true,
        embeds: [embed(ctx.db, {
          title: `Alerts — ${server.name}`,
          fields: rows.map((r) => ({ name: r.event_type, value: `${r.enabled ? 'on' : 'off'} → ${r.channel_id || 'default'}`, inline: true }))
        })]
      });
      return;
    }
    const event = interaction.options.getString('event', true);
    const enabled = interaction.options.getBoolean('enabled', true);
    const channel = interaction.options.getChannel('channel');
    setAlert(ctx.db, server.id, event, enabled, channel?.id);
    await interaction.reply({ content: `Alert \`${event}\` ${enabled ? 'enabled' : 'disabled'}.`, ephemeral: true });
  }
};
