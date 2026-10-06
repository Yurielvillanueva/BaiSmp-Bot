const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { embed } = require('../../util/embeds');
const { t } = require('../../i18n');
const { formatDuration } = require('../../util/sanitize');
const { postStaffLog } = require('./console');

async function punishCmd(interaction, ctx, type) {
  const user = interaction.options.getUser('user');
  const player = interaction.options.getString('player');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const duration = interaction.options.getString('duration');
  const linked = user ? ctx.links.getByDiscord(user.id)[0] : ctx.db.raw.prepare('SELECT * FROM linked_accounts WHERE username = ? COLLATE NOCASE').get(player);
  await interaction.deferReply();
  const caseId = await ctx.moderation.punish({
    guild: interaction.guild,
    actorId: interaction.user.id,
    type,
    targetDiscordId: user?.id || linked?.discord_id,
    targetUuid: linked?.minecraft_uuid,
    targetName: player || linked?.username,
    duration,
    reason
  });
  await postStaffLog(ctx, interaction, caseId, type, reason);
  await interaction.editReply({
    embeds: [embed(ctx.db, { title: `${type} ${caseId}`, description: `${player || user?.tag}: ${reason}` })]
  });
}

const playerOpts = (b) => b
  .addUserOption((o) => o.setName('user').setDescription('Discord user'))
  .addStringOption((o) => o.setName('player').setDescription('Minecraft name'))
  .addStringOption((o) => o.setName('reason').setDescription('Reason'));

module.exports = [
  {
    data: playerOpts(new SlashCommandBuilder().setName('warn').setDescription('Warn a player')).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    staff: 'helper',
    execute: (i, c) => punishCmd(i, c, 'warn')
  },
  {
    data: playerOpts(new SlashCommandBuilder().setName('mute').setDescription('Mute a player')
      .addStringOption((o) => o.setName('duration').setDescription('e.g. 12h'))).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    staff: 'mod',
    execute: (i, c) => punishCmd(i, c, i.options.getString('duration') ? 'tempmute' : 'mute')
  },
  {
    data: playerOpts(new SlashCommandBuilder().setName('kick').setDescription('Kick a player')).setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    staff: 'mod',
    execute: (i, c) => punishCmd(i, c, 'kick')
  },
  {
    data: playerOpts(new SlashCommandBuilder().setName('ban').setDescription('Ban a player')).setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    staff: 'admin',
    execute: (i, c) => punishCmd(i, c, 'ban')
  },
  {
    data: playerOpts(new SlashCommandBuilder().setName('tempban').setDescription('Temporary ban')
      .addStringOption((o) => o.setName('duration').setDescription('e.g. 7d').setRequired(true))).setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    staff: 'mod',
    execute: (i, c) => punishCmd(i, c, 'tempban')
  },
  {
    data: new SlashCommandBuilder()
      .setName('appeal')
      .setDescription('Appeal a punishment')
      .addStringOption((o) => o.setName('case_id').setDescription('Case ID').setRequired(true))
      .addStringOption((o) => o.setName('explanation').setDescription('Why it should be lifted').setRequired(true)),
    async execute(interaction, ctx) {
      await interaction.deferReply({ ephemeral: true });
      try {
        const { channel, punish } = await ctx.appeals.open({
          guild: interaction.guild,
          user: interaction.user,
          caseId: interaction.options.getString('case_id', true),
          explanation: interaction.options.getString('explanation', true)
        });
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`appeal_accept:${channel.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`appeal_deny:${channel.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );
        await channel.send({
          content: `<@${interaction.user.id}>`,
          embeds: [embed(ctx.db, { title: `Appeal ${punish.case_id}`, description: interaction.options.getString('explanation') })],
          components: [row]
        });
        await interaction.editReply({ content: `Appeal opened in ${channel}` });
      } catch (err) {
        if (err.message === 'NO_CASE') {
          await interaction.editReply({ content: t(ctx.db, 'appeal.missing') });
          return;
        }
        throw err;
      }
    }
  }
];
