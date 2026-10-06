const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle } = require('discord.js');
const { embed } = require('../util/embeds');
const { formatDuration } = require('../util/sanitize');
const { t } = require('../i18n');

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('votes')
      .setDescription('Vote stats')
      .addStringOption((o) => o.setName('player').setDescription('Username')),
    async execute(interaction, ctx) {
      const name = interaction.options.getString('player') || ctx.links.getByDiscord(interaction.user.id)[0]?.username;
      if (!name) {
        await interaction.reply({ content: 'Provide a player name or link an account.', ephemeral: true });
        return;
      }
      await interaction.reply({
        embeds: [embed(ctx.db, {
          title: `Votes ${name}`,
          fields: [
            { name: 'Total', value: String(ctx.rewards.count(name)), inline: true },
            { name: 'Streak', value: String(ctx.rewards.streak(name)), inline: true }
          ]
        })]
      });
    }
  },
  {
    data: new SlashCommandBuilder().setName('topvoters').setDescription('Top voters'),
    async execute(interaction, ctx) {
      const rows = ctx.rewards.top(10);
      await interaction.reply({
        embeds: [embed(ctx.db, { title: 'Top voters', description: rows.map((r, i) => `**${i + 1}.** ${r.username} — ${r.votes}`).join('\n') || 'None' })]
      });
    }
  },
  {
    data: new SlashCommandBuilder().setName('daily').setDescription('Claim daily reward'),
    async execute(interaction, ctx) {
      const linked = ctx.links.getByDiscord(interaction.user.id)[0];
      if (!linked) {
        await interaction.reply({ content: 'Link an account first.', ephemeral: true });
        return;
      }
      try {
        const streak = await ctx.rewards.daily(interaction.user.id, linked.username);
        await interaction.reply({ content: `Daily claimed. Streak: ${streak}`, ephemeral: true });
      } catch (err) {
        if (err.message === 'DAILY_COOLDOWN') {
          await interaction.reply({ content: t(ctx.db, 'daily.cooldown', { wait: formatDuration(err.waitMs) }), ephemeral: true });
          return;
        }
        throw err;
      }
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('event')
      .setDescription('Create a scheduled event')
      .addSubcommand((s) => s.setName('create').setDescription('Create event')
        .addStringOption((o) => o.setName('name').setRequired(true).setDescription('Name'))
        .addStringOption((o) => o.setName('starts_at').setRequired(true).setDescription('ISO timestamp'))
        .addStringOption((o) => o.setName('description').setDescription('Description')))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
    staff: 'mod',
    async execute(interaction, ctx) {
      const name = interaction.options.getString('name', true);
      const startsAt = Date.parse(interaction.options.getString('starts_at', true));
      if (!startsAt) {
        await interaction.reply({ content: 'Invalid timestamp.', ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const ev = await ctx.events.createScheduled(interaction.guild, {
        name,
        description: interaction.options.getString('description') || '',
        startsAt
      });
      await interaction.editReply({ content: `Created event ${ev.name} (${ev.id})` });
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('Start a giveaway')
      .addStringOption((o) => o.setName('prize').setRequired(true).setDescription('Prize'))
      .addIntegerOption((o) => o.setName('minutes').setRequired(true).setDescription('Duration minutes'))
      .addIntegerOption((o) => o.setName('winners').setDescription('Winner count'))
      .addBooleanOption((o) => o.setName('require_linked').setDescription('Must be linked'))
      .addIntegerOption((o) => o.setName('min_playtime').setDescription('Minimum playtime minutes'))
      .addStringOption((o) => o.setName('reward_command').setDescription('RCON command with {name}'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    staff: 'mod',
    async execute(interaction, ctx) {
      const prize = interaction.options.getString('prize', true);
      const minutes = interaction.options.getInteger('minutes', true);
      const winners = interaction.options.getInteger('winners') || 1;
      const { ButtonBuilder, ButtonStyle } = require('discord.js');
      await interaction.deferReply({ ephemeral: true });
      const placeholder = await ctx.events.createGiveaway({
        channelId: interaction.channel.id,
        messageId: 'pending',
        prize,
        winners,
        requireLinked: interaction.options.getBoolean('require_linked') !== false,
        minPlaytime: interaction.options.getInteger('min_playtime') || 0,
        endsAt: Date.now() + minutes * 60000,
        rewardCommand: interaction.options.getString('reward_command')
      });
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway_enter:${placeholder}`).setLabel('Enter').setStyle(ButtonStyle.Success));
      const msg = await interaction.channel.send({
        embeds: [embed(ctx.db, { title: `Giveaway: ${prize}`, description: `Ends <t:${Math.floor((Date.now() + minutes * 60000) / 1000)}:R>` })],
        components: [row]
      });
      ctx.db.raw.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?').run(msg.id, placeholder);
      await interaction.editReply({ content: 'Giveaway started.' });
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('config')
      .setDescription('Edit live configuration')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    staff: 'owner',
    async execute(interaction, ctx) {
      const keys = Object.keys(ctx.db.config.getAll()).slice(0, 25);
      const menu = new StringSelectMenuBuilder().setCustomId('config_select').setPlaceholder('Setting')
        .addOptions(keys.map((k) => ({ label: k.slice(0, 100), value: k })));
      await interaction.reply({
        ephemeral: true,
        content: 'Select a setting to edit. Changes are audited and applied immediately.',
        components: [new ActionRowBuilder().addComponents(menu)]
      });
    }
  }
];

function configModal(key, current) {
  return new ModalBuilder().setCustomId(`config_modal:${key}`).setTitle(`Edit ${key}`.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('value').setLabel('JSON or text value').setStyle(TextInputStyle.Paragraph).setValue(String(current ?? '')).setRequired(true)
    ));
}

module.exports.configModal = configModal;
