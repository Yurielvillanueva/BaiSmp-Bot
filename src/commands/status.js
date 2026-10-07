const { SlashCommandBuilder } = require('discord.js');
const { isIP } = require('node:net');
const { pingServer, statusEmbed } = require('../services/status');

function validHost(host) {
  if (isIP(host)) return true;
  if (host.length > 253) return false;
  return host.split('.').every((label) => (
    label.length > 0
    && label.length <= 63
    && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)
  ));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show the Minecraft server status')
    .addStringOption((option) => option
      .setName('address')
      .setDescription('Minecraft server IP or hostname (use with port)')
      .setMaxLength(253)
      .setRequired(false))
    .addIntegerOption((option) => option
      .setName('port')
      .setDescription('Minecraft server port (defaults to 25565)')
      .setMinValue(1)
      .setMaxValue(65535)
      .setRequired(false)),
  async execute(interaction, ctx) {
    const requestedHost = interaction.options.getString('address')?.trim();
    const requestedPort = interaction.options.getInteger('port');

    if (requestedHost || requestedPort != null) {
      if (!requestedHost || !validHost(requestedHost)) {
        await interaction.reply({
          content: 'Enter a valid IP address or hostname in `address` (without a port), then optionally set `port`.',
          ephemeral: true
        });
        return;
      }
      const server = {
        name: requestedHost,
        host: requestedHost,
        query_port: requestedPort || 25565,
        maintenance: false
      };
      const ping = await pingServer(server);
      const response = { embeds: [statusEmbed(ctx.db, server, ping)] };
      try {
        await interaction.reply(response);
      } catch (err) {
        if (err.code !== 40060) throw err;
        await interaction.editReply(response);
      }
      return;
    }

    const servers = ctx.db.servers.all();
    const selectedServers = servers;

    if (selectedServers.length === 0) {
      await interaction.reply({
        content: 'No Minecraft servers are configured.',
        ephemeral: true
      });
      return;
    }

    const visibleServers = selectedServers.slice(0, 10);
    await interaction.deferReply({ ephemeral: true });
    const pings = await Promise.all(visibleServers.map((server) => pingServer(server, ctx)));
    for (const [index, server] of visibleServers.entries()) {
      await ctx.status.publish(server, pings[index], interaction.channel);
    }
    const extraCount = selectedServers.length - visibleServers.length;
    await interaction.editReply({
      content: `Live status panel${visibleServers.length === 1 ? '' : 's'} updated in this channel. It refreshes automatically every ${Math.round(ctx.env.STATUS_INTERVAL_MS / 1000)} seconds.${extraCount > 0 ? ` Showing ${visibleServers.length} of ${selectedServers.length} configured servers.` : ''}`
    });
  }
};
