const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { t } = require('../../i18n');
const { embed } = require('../../util/embeds');
const { sendRcon, assertStaffCommand } = require('../../services/rcon');
const { cfg } = require('../../config/store');

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('console')
      .setDescription('Run an RCON command')
      .addSubcommand((s) => s.setName('run').setDescription('Run a command')
        .addStringOption((o) => o.setName('command').setDescription('Minecraft command').setRequired(true))
        .addStringOption((o) => o.setName('server').setDescription('Server name')))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    staff: 'helper',
    async execute(interaction, ctx) {
      if (cfg(ctx.db, 'rcon_kill_switch')) {
        await interaction.reply({ content: t(ctx.db, 'rcon.disabled'), ephemeral: true });
        return;
      }
      const raw = interaction.options.getString('command', true);
      const name = interaction.options.getString('server');
      const server = name ? ctx.db.servers.getByName(name) : ctx.db.servers.all()[0];
      const check = assertStaffCommand(ctx.db, interaction.member, raw);
      if (!check.ok) {
        await interaction.reply({ content: t(ctx.db, check.reason === 'blocked' ? 'rcon.blocked' : 'rcon.denied'), ephemeral: true });
        return;
      }
      if (check.confirm) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rcon_confirm:${Buffer.from(JSON.stringify({ c: check.command, s: server.id })).toString('base64url')}`)
            .setLabel('Confirm').setStyle(ButtonStyle.Danger)
        );
        await interaction.reply({ content: `Confirm destructive command \`${check.command}\`?`, components: [row], ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const { result } = await sendRcon(ctx.env, ctx.db, server, check.command);
      const caseId = ctx.staffLog.add({
        actorId: interaction.user.id,
        action: 'rcon',
        reason: check.command,
        result,
        targetName: server.name
      });
      await postStaffLog(ctx, interaction, caseId, 'RCON', check.command);
      await interaction.editReply({ embeds: [embed(ctx.db, { title: 'RCON', description: `\`\`\`\n${result || '(empty)'}\n\`\`\`` })] });
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('killswitch')
      .setDescription('Disable or enable all RCON features')
      .addStringOption((o) => o.setName('state').setDescription('on or off').setRequired(true).addChoices(
        { name: 'on (disable RCON)', value: 'on' },
        { name: 'off (enable RCON)', value: 'off' }
      ))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    staff: 'owner',
    async execute(interaction, ctx) {
      const on = interaction.options.getString('state') === 'on';
      ctx.db.config.set('rcon_kill_switch', on, interaction.user.id);
      await interaction.reply({ content: `RCON kill switch ${on ? 'ENABLED' : 'disabled'}.`, ephemeral: true });
    }
  }
];

async function postStaffLog(ctx, interaction, caseId, action, reason) {
  const chId = ctx.db.config.get('staff_log_channel_id');
  if (!chId) return;
  const ch = await interaction.client.channels.fetch(chId).catch(() => null);
  if (!ch) return;
  await ch.send({ embeds: [embed(ctx.db, { title: `${action} ${caseId}`, description: reason })] });
}

module.exports.postStaffLog = postStaffLog;
