const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { embed } = require('../util/embeds');
const { AttachmentBuilder } = require('discord.js');

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
      const all = ctx.staffLog.allForExport();
      const csv = ['case_id,actor,target,action,reason,result,created_at', ...all.map((r) => [r.case_id, r.actor_discord_id, r.target_name, r.action, JSON.stringify(r.reason || ''), r.result, r.created_at].join(','))].join('\n');
      await interaction.reply({
        ephemeral: true,
        files: [new AttachmentBuilder(Buffer.from(csv), { name: 'logbook.csv' })]
      });
    }
  }
];
