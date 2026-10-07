const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { embed } = require('../util/embeds');
const { AttachmentBuilder } = require('discord.js');

function csvCell(value) {
  const text = String(value ?? '');
  const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Player statistics')
      .addSubcommand((s) => s.setName('player').setDescription('Show stats')
        .addStringOption((o) => o.setName('player').setDescription('Username').setRequired(true))),
    async execute(interaction, ctx) {
      const name = interaction.options.getString('player', true);
      const linked = ctx.db.raw.prepare('SELECT * FROM linked_accounts WHERE username = ? COLLATE NOCASE').get(name)
        || ctx.links.getByDiscord(interaction.user.id)[0];
      const username = linked?.username || name;
      const uuid = linked?.minecraft_uuid;
      await interaction.deferReply();
      try {
        const stats = await ctx.stats.forPlayer(username, uuid);
        await interaction.editReply({
          embeds: [embed(ctx.db, {
            title: `${stats.username || username} stats`,
            fields: [
              { name: 'Playtime', value: `${stats.playtimeMin} min`, inline: true },
              { name: 'Deaths', value: String(stats.deaths), inline: true },
              { name: 'Mob kills', value: String(stats.mobKills), inline: true },
              { name: 'Blocks mined', value: String(stats.mined), inline: true },
              { name: 'Walk cm', value: String(stats.walkCm), inline: true },
              { name: 'Joins', value: String(stats.joins), inline: true }
            ]
          }).setThumbnail(stats.head)]
        });
      } catch {
        await interaction.editReply({ content: 'Stats not available. Link the account or ensure the plugin/world stats path is set.' });
      }
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('top')
      .setDescription('Leaderboards')
      .addStringOption((o) => o.setName('board').setDescription('Board').setRequired(true)
        .addChoices({ name: 'playtime', value: 'playtime' }, { name: 'kills', value: 'kills' }, { name: 'deaths', value: 'deaths' })),
    async execute(interaction, ctx) {
      await interaction.deferReply();
      const board = interaction.options.getString('board', true);
      const linked = ctx.db.raw.prepare('SELECT username, minecraft_uuid FROM linked_accounts').all();
      const rows = [];
      for (const acc of linked.slice(0, 40)) {
        try {
          const s = await ctx.stats.forPlayer(acc.username, acc.minecraft_uuid);
          rows.push({
            name: acc.username,
            value: board === 'playtime' ? s.playtimeMin : board === 'kills' ? s.mobKills : s.deaths
          });
        } catch { /* skip */ }
      }
      rows.sort((a, b) => b.value - a.value);
      await interaction.editReply({
        embeds: [embed(ctx.db, {
          title: `Top ${board}`,
          description: rows.slice(0, 10).map((r, i) => `**${i + 1}.** ${r.name} — ${r.value}`).join('\n') || 'No data'
        })]
      });
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('logbook')
      .setDescription('Staff log book')
      .addSubcommand((s) => s.setName('add').setDescription('Add a note')
        .addStringOption((o) => o.setName('player').setDescription('Target').setRequired(true))
        .addStringOption((o) => o.setName('note').setDescription('Note').setRequired(true)))
      .addSubcommand((s) => s.setName('view').setDescription('View player log')
        .addStringOption((o) => o.setName('player').setDescription('Name').setRequired(true)))
      .addSubcommand((s) => s.setName('search').setDescription('Search logs')
        .addStringOption((o) => o.setName('query').setDescription('Query').setRequired(true))
        .addStringOption((o) => o.setName('action').setDescription('Action type')))
      .addSubcommand((s) => s.setName('case').setDescription('View one case by its ID')
        .addStringOption((o) => o.setName('case_id').setDescription('Case ID').setRequired(true).setMaxLength(64)))
      .addSubcommand((s) => s.setName('export').setDescription('Export CSV'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    staff: 'mod',
    async execute(interaction, ctx) {
      const sub = interaction.options.getSubcommand();
      if (sub === 'add') {
        const player = interaction.options.getString('player', true);
        const note = interaction.options.getString('note', true);
        const caseId = ctx.staffLog.add({ actorId: interaction.user.id, targetName: player, action: 'note', reason: note, result: 'logged' });
        await interaction.reply({ content: `Logged ${caseId}`, ephemeral: true });
        return;
      }
      if (sub === 'view') {
        const player = interaction.options.getString('player', true);
        const rows = ctx.staffLog.viewPlayer(player);
        await interaction.reply({
          ephemeral: true,
          embeds: [embed(ctx.db, {
            title: `Log ${player}`,
            description: rows.map((r) => `\`${r.case_id}\` ${r.action} — ${r.reason || ''} (${r.created_at})`).join('\n').slice(0, 4000) || 'Empty'
          })]
        });
        return;
      }
      if (sub === 'search') {
        const query = interaction.options.getString('query', true);
        const action = interaction.options.getString('action');
        const rows = ctx.staffLog.search({ query, action });
        await interaction.reply({
          ephemeral: true,
          embeds: [embed(ctx.db, { title: 'Search', description: rows.map((r) => `\`${r.case_id}\` ${r.action} ${r.target_name || ''} ${r.reason || ''}`).join('\n').slice(0, 4000) || 'None' })]
        });
        return;
      }
      if (sub === 'case') {
        const caseId = interaction.options.getString('case_id', true).trim();
        const record = ctx.staffLog.getByCase(caseId);
        if (!record) {
          await interaction.reply({ content: `No staff case found with ID \`${caseId}\`.`, ephemeral: true });
          return;
        }
        const fields = [
          { name: 'Action', value: String(record.action || '—').slice(0, 1024), inline: true },
          { name: 'Actor', value: record.actor_discord_id ? `<@${record.actor_discord_id}>` : 'System', inline: true },
          { name: 'Target', value: record.target_name || (record.target_discord_id ? `<@${record.target_discord_id}>` : '—'), inline: true },
          { name: 'Reason', value: String(record.reason || '—').slice(0, 1024), inline: false },
          { name: 'Result', value: String(record.result || '—').slice(0, 1024), inline: false },
          { name: 'Created', value: String(record.created_at || '—').slice(0, 128), inline: false }
        ];
        if (record.metadata) {
          fields.push({ name: 'Metadata', value: `\`\`\`json\n${String(record.metadata).slice(0, 900)}\n\`\`\``, inline: false });
        }
        await interaction.reply({
          ephemeral: true,
          embeds: [embed(ctx.db, { title: `Staff case ${record.case_id}`, fields })]
        });
        return;
      }
      const all = ctx.staffLog.allForExport();
      const columns = ['case_id', 'actor_discord_id', 'target_discord_id', 'target_uuid', 'target_name', 'action', 'reason', 'result', 'metadata', 'created_at'];
      const csv = [
        columns.map(csvCell).join(','),
        ...all.map((row) => columns.map((column) => csvCell(row[column])).join(','))
      ].join('\r\n');
      await interaction.reply({
        ephemeral: true,
        files: [new AttachmentBuilder(Buffer.from(csv), { name: 'logbook.csv' })]
      });
    }
  }
];
