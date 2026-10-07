const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { t } = require('../../i18n');
const { cfg } = require('../../config/store');
const { embed } = require('../../util/embeds');
const { mojangProfile } = require('../../services/linking');

function linkedRole(member, db, add) {
  const role = cfg(db, 'linked_role_id');
  if (!role) return Promise.resolve();
  return add ? member.roles.add(role).catch(() => {}) : member.roles.remove(role).catch(() => {});
}

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('link')
      .setDescription('Link your Minecraft account with a code from /link in-game')
      .addStringOption((o) => o.setName('code').setDescription('6-character code').setRequired(true)),
    async execute(interaction, ctx) {
      const code = interaction.options.getString('code', true);
      let row;
      try {
        row = ctx.links.completeLink(code, interaction.user.id);
      } catch (err) {
        if (err.message === 'LINK_LIMIT') {
          await interaction.reply({ content: t(ctx.db, 'link.limit'), ephemeral: true });
          return;
        }
        if (err.message === 'UUID_TAKEN') {
          await interaction.reply({ content: 'That Minecraft account is already linked to another Discord account.', ephemeral: true });
          return;
        }
        throw err;
      }
      if (!row) {
        await interaction.reply({ content: t(ctx.db, 'link.invalid'), ephemeral: true });
        return;
      }
      await linkedRole(interaction.member, ctx.db, true);
      await interaction.reply({ content: t(ctx.db, 'link.success', { username: row.username, uuid: row.minecraft_uuid }), ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder().setName('unlink').setDescription('Unlink your Minecraft account'),
    async execute(interaction, ctx) {
      ctx.links.unlink(interaction.user.id);
      await linkedRole(interaction.member, ctx.db, false);
      await interaction.reply({ content: t(ctx.db, 'unlink.success'), ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('whois')
      .setDescription('Staff: look up a linked account')
      .addUserOption((o) => o.setName('user').setDescription('Discord user'))
      .addStringOption((o) => o.setName('player').setDescription('Minecraft username'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    staff: 'helper',
    async execute(interaction, ctx) {
      const user = interaction.options.getUser('user');
      const player = interaction.options.getString('player');
      let rows = [];
      await interaction.deferReply({ ephemeral: true });
      if (user) rows = ctx.links.whois({ discordId: user.id });
      else if (player) {
        const profile = await mojangProfile(player).catch(() => null);
        rows = ctx.links.whois({ username: player, uuid: profile?.uuid });
      }
      if (!rows.length) {
        await interaction.editReply({ content: 'No linked account found.' });
        return;
      }
      await interaction.editReply({
        embeds: [embed(ctx.db, {
          title: 'Whois',
          fields: rows.map((r) => ({ name: r.username, value: `UUID ${r.minecraft_uuid}\nDiscord <@${r.discord_id}>\nLinked ${r.linked_at}` }))
        })]
      });
    }
  }
];
