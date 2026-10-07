const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const { embed } = require('../../util/embeds');
const { sendRcon } = require('../../services/rcon');
const { pingServer } = require('../../services/status');
const { renderPerfChart } = require('../../services/perf');
const { diagnostics } = require('../../http/server');
const { logger } = require('../../logger');

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('server')
      .setDescription('Network servers')
      .addSubcommand((s) => s.setName('list').setDescription('List servers and player counts')),
    async execute(interaction, ctx) {
      const servers = ctx.db.servers.all();
      await interaction.deferReply();
      const fields = [];
      let total = 0;
      let max = 0;
      const pings = await Promise.all(servers.map((server) => pingServer(server, ctx)));
      for (const [index, ping] of pings.entries()) {
        const s = servers[index];
        total += ping.players;
        max += ping.max;
        fields.push({ name: s.name, value: ping.online ? `${ping.players}/${ping.max}` : 'offline', inline: true });
      }
      await interaction.editReply({ embeds: [embed(ctx.db, { title: `Network ${total}/${max}`, fields })] });
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('backup')
      .setDescription('World backups')
      .addSubcommand((s) => s.setName('now').setDescription('Run a backup now'))
      .addSubcommand((s) => s.setName('list').setDescription('List backups'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    staff: 'admin',
    async execute(interaction, ctx) {
      const server = ctx.db.servers.all()[0];
      if (interaction.options.getSubcommand() === 'list') {
        const rows = ctx.backups.list(server);
        await interaction.reply({
          ephemeral: true,
          embeds: [embed(ctx.db, { title: 'Backups', description: rows.map((r) => `${new Date(r.created_at).toISOString()} ${r.bytes} bytes`).join('\n') || 'None' })]
        });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const file = await ctx.backups.run(server, interaction.user.id);
      await interaction.editReply({ content: `Backup stored (encrypted): \`${file}\`` });
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('restart')
      .setDescription('Restart with countdown warnings')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    staff: 'admin',
    async execute(interaction, ctx) {
      const server = ctx.db.servers.all()[0];
      await interaction.reply({ content: 'Restart scheduled: 5m, 1m, 10s warnings.', ephemeral: true });
      const say = async (msg, wait) => {
        await sendRcon(ctx.env, ctx.db, server, `say ${msg}`);
        await new Promise((r) => setTimeout(r, wait));
      };
      await say('Server restart in 5 minutes', 4 * 60 * 1000);
      await say('Server restart in 1 minute', 50 * 1000);
      await say('Server restart in 10 seconds', 10 * 1000);
      await sendRcon(ctx.env, ctx.db, server, 'stop');
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('maintenance')
      .setDescription('Toggle maintenance whitelist')
      .addStringOption((o) => o
    .setName('state')
    .setDescription('Turn maintenance mode on or off')
    .setRequired(true)
    .addChoices(
      { name: 'on', value: 'on' },
      { name: 'off', value: 'off' }
    ))
  .addStringOption((o) => o
    .setName('server')
    .setDescription('Server name (required when more than one is configured)')
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    staff: 'admin',
    async execute(interaction, ctx) {
  const on = interaction.options.getString('state') === 'on';
  const servers = ctx.db.servers.all();
  const requestedName = interaction.options.getString('server');
  const server = requestedName
    ? servers.find((item) => item.name.toLowerCase() === requestedName.toLowerCase())
    : servers.length === 1 ? servers[0] : null;
  if (!server) {
    const message = requestedName
      ? `No enabled server named "${requestedName}" was found.`
      : servers.length
        ? `Choose a server with the \`server\` option. Available: ${servers.map((item) => item.name).join(', ')}.`
        : 'No enabled Minecraft servers are configured.';
    await interaction.reply({ content: message, ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const { result } = await sendRcon(ctx.env, ctx.db, server, on ? 'whitelist on' : 'whitelist off');
  ctx.db.servers.setMaintenance(server.id, on);
  ctx.staffLog.add({
    actorId: interaction.user.id,
    action: `maintenance_${on ? 'on' : 'off'}`,
    targetName: server.name,
    reason: `Maintenance ${on ? 'enabled' : 'disabled'}`,
    result: result || 'RCON accepted command',
    metadata: { serverId: server.id }
  });
  let statusRefreshed = true;
  try {
    await ctx.status.tick();
  } catch (err) {
    statusRefreshed = false;
    logger.warn({ err, server: server.name }, 'failed to refresh status after maintenance change');
  }
  await interaction.editReply({
    content: `Maintenance ${on ? 'enabled' : 'disabled'} for **${server.name}**. Whitelist command succeeded.${statusRefreshed ? '' : ' The status panel could not be refreshed and will retry automatically.'}`
  });
    }
  },
  {
    data: new SlashCommandBuilder().setName('perf').setDescription('Performance chart (7 days)'),
    staff: 'mod',
    async execute(interaction, ctx) {
      await interaction.deferReply();
      const server = ctx.db.servers.all()[0];
      const samples = ctx.perf.history(server.id);
      if (samples.length < 2) {
        await interaction.editReply({ content: 'Not enough samples yet.' });
        return;
      }
      const buf = await renderPerfChart(samples);
      await interaction.editReply({ files: [new AttachmentBuilder(buf, { name: 'perf.png' })] });
    }
  },
  {
    data: new SlashCommandBuilder().setName('diagnostics').setDescription('Check Discord, RCON, plugin, database')
      .addStringOption((o) => o.setName('server').setDescription('Server to check (defaults to the first enabled server)').setMaxLength(100))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    staff: 'admin',
    async execute(interaction, ctx) {
      await interaction.deferReply({ ephemeral: true });
      const requestedName = interaction.options.getString('server');
      const servers = ctx.db.servers.all();
      const server = requestedName
        ? servers.find((item) => item.name.toLowerCase() === requestedName.toLowerCase())
        : servers[0];
      if (requestedName && !server) {
        await interaction.editReply({ content: `No enabled server named "${requestedName}" was found.` });
        return;
      }
      const checks = await diagnostics(ctx, server);
      await interaction.editReply({
        embeds: [embed(ctx.db, {
          title: `Diagnostics${server ? ` · ${server.name}` : ''}`,
          fields: checks.map((check) => ({
            name: `${check.ok ? '✅' : '❌'} ${check.name}`,
            value: check.detail.slice(0, 1024),
            inline: false
          }))
        })]
      });
    }
  }
];
