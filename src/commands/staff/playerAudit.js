const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { embed } = require('../../util/embeds');

function expiryLabel(row) {
  if (!row.active) return 'Inactive';
  if (!row.expires_at) return 'Active · permanent';
  const expiresAt = Number(row.expires_at);
  if (!Number.isFinite(expiresAt)) return 'Active';
  return `Active · expires <t:${Math.floor(expiresAt / 1000)}:R>`;
}

function findLinkedByUsername(db, username) {
  return db.raw.prepare('SELECT * FROM linked_accounts WHERE username = ? COLLATE NOCASE').get(username);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('playeraudit')
    .setDescription('Privately review a player’s linked account and punishment history')
    .addUserOption((option) => option.setName('user').setDescription('Discord account'))
    .addStringOption((option) => option.setName('player').setDescription('Minecraft username').setMaxLength(16))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  staff: 'mod',
  async execute(interaction, ctx) {
    const user = interaction.options.getUser('user');
    const player = interaction.options.getString('player')?.trim();
    if (!user && !player) {
      await interaction.reply({
        content: 'Provide either a Discord user or a Minecraft username.',
        ephemeral: true
      });
      return;
    }

    const linked = user
      ? ctx.links.getByDiscord(user.id)[0]
      : findLinkedByUsername(ctx.db, player);
    const target = {
      discordId: user?.id || linked?.discord_id,
      uuid: linked?.minecraft_uuid,
      username: player || linked?.username
    };
    const rows = ctx.moderation.historyForTarget(target);
    const active = rows.filter((row) => row.active);
    const punishments = rows.length
      ? rows.map((row) => {
        const actor = row.actor_discord_id && row.actor_discord_id !== 'system'
          ? `<@${row.actor_discord_id}>`
          : 'System / unavailable';
        return `\`${row.case_id}\` **${row.type}** · ${expiryLabel(row)} · by ${actor}\n${String(row.reason || 'No reason recorded').slice(0, 180)}`;
      }).join('\n\n')
      : 'No punishment records found.';

    await interaction.reply({
      ephemeral: true,
      embeds: [embed(ctx.db, {
        title: `Player audit · ${target.username || user?.tag || 'Unknown player'}`,
        description: punishments.slice(0, 4000),
        fields: [
          { name: 'Discord', value: target.discordId ? `<@${target.discordId}>` : 'Not linked', inline: true },
          { name: 'Minecraft UUID', value: target.uuid || 'Unknown', inline: true },
          { name: 'Active punishments', value: String(active.length), inline: true },
          { name: 'Cases shown', value: `${rows.length} recent punishment records (max 10)`, inline: false }
        ]
      })]
    });
  }
};
