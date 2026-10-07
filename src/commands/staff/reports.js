const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { embed } = require('../../util/embeds');

const PERIODS = [
  { name: 'Last 24 hours', value: '24h' },
  { name: 'Last 7 days', value: '7d' },
  { name: 'Last 30 days', value: '30d' },
  { name: 'All time', value: 'all' }
];

function cutoff(period) {
  const duration = { '24h': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000, '30d': 30 * 24 * 60 * 60 * 1000 }[period];
  if (!duration) return null;
  return new Date(Date.now() - duration).toISOString().slice(0, 19).replace('T', ' ');
}

function periodOption(option) {
  return option.setName('period').setDescription('Time range').setRequired(true)
    .addChoices(...PERIODS);
}

function formatAudit(row) {
  const actor = row.actor_discord_id ? `<@${row.actor_discord_id}>` : 'System';
  const target = row.target_name || (row.target_discord_id ? `<@${row.target_discord_id}>` : '—');
  const reason = row.reason ? ` — ${row.reason}` : '';
  return `\`${row.case_id}\` **${row.action}** · ${actor} → ${target}${reason}`;
}

function formatActor(actorId) {
  return actorId && actorId !== 'system' ? `<@${actorId}>` : 'System';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('staffreport')
    .setDescription('Review staff activity and moderation audit summaries')
    .addSubcommand((sub) => sub.setName('activity').setDescription('Staff action counts')
      .addStringOption(periodOption)
      .addUserOption((option) => option.setName('staff').setDescription('Limit to one staff member')))
    .addSubcommand((sub) => sub.setName('moderation').setDescription('Moderation action totals')
      .addStringOption(periodOption))
    .addSubcommand((sub) => sub.setName('audit').setDescription('Filter recent audit records')
      .addStringOption(periodOption)
      .addUserOption((option) => option.setName('staff').setDescription('Filter by staff member'))
      .addStringOption((option) => option.setName('action').setDescription('Exact action name').setMaxLength(64)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  staff: 'admin',
  async execute(interaction, ctx) {
    const subcommand = interaction.options.getSubcommand();
    const period = interaction.options.getString('period', true);
    const since = cutoff(period);
    const rangeLabel = PERIODS.find((entry) => entry.value === period)?.name || 'Selected period';

    if (subcommand === 'activity') {
      const staff = interaction.options.getUser('staff');
      const rows = ctx.staffLog.activity({ since, actorId: staff?.id });
      const description = rows.length
        ? rows.map((row) => `${formatActor(row.actor_discord_id)} — **${row.action}**: ${row.count}`).join('\n')
        : 'No staff actions were recorded in this period.';
      await interaction.reply({
        ephemeral: true,
        embeds: [embed(ctx.db, {
          title: `Staff activity · ${rangeLabel}`,
          description: description.slice(0, 4000),
          fields: [{ name: 'Staff filter', value: staff ? `<@${staff.id}>` : 'All staff', inline: true }]
        })]
      });
      return;
    }

    if (subcommand === 'moderation') {
      const summary = ctx.staffLog.moderationSummary({ since });
      const description = summary.actions.length
        ? summary.actions.map((row) => `**${row.action}** — ${row.count}`).join('\n')
        : 'No moderation actions were recorded in this period.';
      await interaction.reply({
        ephemeral: true,
        embeds: [embed(ctx.db, {
          title: `Moderation summary · ${rangeLabel}`,
          description,
          fields: [{ name: 'Total actions', value: String(summary.total), inline: true }]
        })]
      });
      return;
    }

    const staff = interaction.options.getUser('staff');
    const action = interaction.options.getString('action')?.trim();
    const rows = ctx.staffLog.auditSearch({ since, actorId: staff?.id, action, limit: 15 });
    const description = rows.length
      ? rows.map(formatAudit).join('\n').slice(0, 4000)
      : 'No audit records matched those filters.';
    await interaction.reply({
      ephemeral: true,
      embeds: [embed(ctx.db, {
        title: `Audit results · ${rangeLabel}`,
        description,
        fields: [
          { name: 'Staff', value: staff ? `<@${staff.id}>` : 'All staff', inline: true },
          { name: 'Action', value: action || 'All actions', inline: true },
          { name: 'Results shown (max 15)', value: String(rows.length), inline: true }
        ]
      })]
    });
  }
};
