const { SlashCommandBuilder } = require('discord.js');
const { embed } = require('../util/embeds');
const { pingServer } = require('../services/status');

function formatPlaytime(minutes) {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (remainingMinutes || !parts.length) parts.push(`${remainingMinutes}m`);
  return parts.join(' ');
}

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('online')
      .setDescription('See online players and player counts')
      .addStringOption((option) => option
        .setName('server')
        .setDescription('Filter by a configured server name')
        .setMaxLength(64)),
    async execute(interaction, ctx) {
      const servers = ctx.db.servers.all();
      const requestedServer = interaction.options.getString('server')?.trim();
      const selected = requestedServer
        ? servers.filter((server) => server.name.toLocaleLowerCase() === requestedServer.toLocaleLowerCase())
        : servers;

      if (!selected.length) {
        await interaction.reply({
          content: requestedServer ? `No configured server named \`${requestedServer}\` was found.` : 'No Minecraft servers are configured.',
          ephemeral: true
        });
        return;
      }

      const visible = selected.slice(0, 10);
      await interaction.deferReply();
      const results = await Promise.all(visible.map(async (server) => ({
        server,
        ping: await pingServer(server, ctx)
      })));
      const fields = results.map(({ server, ping }) => ({
        name: server.name,
        value: `${ping.online ? '🟢 Online' : '🔴 Offline'} · **${ping.players}/${ping.max}** players\n${ping.sample.length
          ? `Players: ${ping.sample.slice(0, 20).join(', ')}`
          : 'Player names are not available from this server.'}`,
        inline: false
      }));
      const omitted = selected.length - visible.length;
      await interaction.editReply({
        embeds: [embed(ctx.db, {
          title: 'Players online',
          description: omitted ? `Showing ${visible.length} of ${selected.length} configured servers.` : undefined,
          fields
        })]
      });
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('playtime')
      .setDescription('Check your linked Minecraft account playtime'),
    async execute(interaction, ctx) {
      const account = ctx.links.getByDiscord(interaction.user.id)[0];
      if (!account) {
        await interaction.reply({
          content: 'Link your Minecraft account first with `/link` to check your playtime.',
          ephemeral: true
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      try {
        const stats = await ctx.stats.forPlayer(account.username, account.minecraft_uuid);
        await interaction.editReply({
          embeds: [embed(ctx.db, {
            title: `${account.username}'s playtime`,
            description: `**${formatPlaytime(stats.playtimeMin)}**`
          }).setThumbnail(stats.head)]
        });
      } catch (err) {
        if (err.message !== 'NO_STATS') throw err;
        await interaction.editReply({
          content: 'Playtime data is unavailable. Ask staff to check the Minecraft stats integration.'
        });
      }
    }
  }
];

module.exports._test = { formatPlaytime };
