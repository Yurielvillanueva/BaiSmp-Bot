const {
  SlashCommandBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { embed } = require('../../util/embeds');
const { t } = require('../../i18n');
const { postStaffLog } = require('./console');
const { requireTier } = require('../../util/staff');
const { logger } = require('../../logger');

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
      .setDescription('Submit and track punishment appeals')
      .addSubcommand((s) => s.setName('submit').setDescription('Appeal an active ban or mute')
        .addStringOption((o) => o.setName('reason').setDescription('Explain why the punishment should be reviewed').setRequired(true).setMaxLength(1000))
        .addStringOption((o) => o.setName('ign').setDescription('Your linked Minecraft username').setMaxLength(32))
        .addStringOption((o) => o.setName('case_id').setDescription('Punishment case ID (legacy option)').setMaxLength(64)))
      .addSubcommand((s) => s.setName('status').setDescription('Check your appeals, or one by appeal number')
        .addIntegerOption((o) => o.setName('number').setDescription('Appeal number').setMinValue(1)))
      .addSubcommand((s) => s.setName('add').setDescription('Add information to your open appeal')
        .addIntegerOption((o) => o.setName('number').setDescription('Appeal number').setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName('message').setDescription('Additional information or evidence').setRequired(true).setMaxLength(1000)))
      .addSubcommand((s) => s.setName('cancel').setDescription('Cancel one of your open appeals')
        .addIntegerOption((o) => o.setName('number').setDescription('Appeal number').setRequired(true).setMinValue(1)))
      .addSubcommand((s) => s.setName('withdraw').setDescription('Withdraw one of your open appeals')
        .addIntegerOption((o) => o.setName('number').setDescription('Appeal number').setRequired(true).setMinValue(1)))
      .addSubcommand((s) => s.setName('list').setDescription('Staff: list recent appeals')
        .addStringOption((o) => o.setName('status').setDescription('Filter by appeal status')
          .addChoices(
            { name: 'All', value: 'all' }, { name: 'Pending', value: 'pending' },
            { name: 'Approved', value: 'approved' }, { name: 'Denied', value: 'denied' },
            { name: 'Closed', value: 'closed' }
          )))
      .addSubcommand((s) => s.setName('view').setDescription('Staff: view an appeal and private notes')
        .addIntegerOption((o) => o.setName('number').setDescription('Appeal number').setRequired(true).setMinValue(1)))
      .addSubcommand((s) => s.setName('accept').setDescription('Staff: cast an accept vote for an appeal')
        .addIntegerOption((o) => o.setName('number').setDescription('Appeal number').setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName('note').setDescription('Decision reason').setMaxLength(1000)))
      .addSubcommand((s) => s.setName('deny').setDescription('Staff: cast a deny vote for an appeal')
        .addIntegerOption((o) => o.setName('number').setDescription('Appeal number').setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName('reason').setDescription('Reason for denial').setRequired(true).setMinLength(10).setMaxLength(1000)))
      .addSubcommand((s) => s.setName('reduce').setDescription('Staff: vote to reduce an active temporary ban')
        .addIntegerOption((o) => o.setName('number').setDescription('Appeal number').setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName('duration').setDescription('New total duration, shorter than the remaining ban (e.g. 2d)').setRequired(true).setMaxLength(32))
        .addStringOption((o) => o.setName('reason').setDescription('Reason for reducing the ban').setRequired(true).setMinLength(10).setMaxLength(1000)))
      .addSubcommand((s) => s.setName('note').setDescription('Staff: add a private note')
        .addIntegerOption((o) => o.setName('number').setDescription('Appeal number').setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName('text').setDescription('Private staff note').setRequired(true).setMaxLength(1000)))
      .addSubcommand((s) => s.setName('assign').setDescription('Staff: assign an appeal')
        .addIntegerOption((o) => o.setName('number').setDescription('Appeal number').setRequired(true).setMinValue(1))
        .addUserOption((o) => o.setName('staff').setDescription('Staff member').setRequired(true)))
      .addSubcommand((s) => s.setName('close').setDescription('Staff: close and archive an appeal')
        .addIntegerOption((o) => o.setName('number').setDescription('Appeal number').setRequired(true).setMinValue(1)))
      .addSubcommand((s) => s.setName('history').setDescription('Staff: show a player punishment and appeal history')
        .addStringOption((o) => o.setName('ign').setDescription('Minecraft username').setRequired(true).setMaxLength(32))),
    async execute(interaction, ctx) {
      const action = interaction.options.getSubcommand();
      const staffActions = new Set(['list', 'view', 'accept', 'deny', 'reduce', 'note', 'assign', 'close', 'history']);
      if (staffActions.has(action) && !requireTier(interaction.member, ctx.db, 'mod')) {
        await interaction.reply({ content: t(ctx.db, 'generic.no_permission'), ephemeral: true });
        return;
      }

      const number = interaction.options.getInteger('number');
      const userInput = (name) => interaction.options.getString(name);
      const appealLabel = (appeal) => `Appeal #${appeal.id} · ${appeal.status}`;
      const statusEmbed = (appeal) => embed(ctx.db, {
        title: appealLabel(appeal),
        fields: [
          { name: 'Punishment case', value: appeal.case_id, inline: true },
          { name: 'Decision votes', value: `${JSON.parse(appeal.accept_votes).length} accept · ${JSON.parse(appeal.deny_votes).length} deny · ${ctx.db.config.get('appeal_min_votes') || 2} needed`, inline: true },
          ...(appeal.decision_action ? [{
            name: 'Decision action',
            value: `${appeal.decision_action}${appeal.decision_duration ? ` · new duration: ${appeal.decision_duration}` : ''}`,
            inline: true
          }] : []),
          { name: 'Your explanation', value: String(appeal.explanation || '').slice(0, 1000) },
          ...(appeal.decision_reason ? [{ name: 'Decision / latest review note', value: appeal.decision_reason.slice(0, 1000) }] : []),
          ...(appeal.channel_id ? [{ name: 'Appeal channel', value: `<#${appeal.channel_id}>` }] : [])
        ]
      });

      if (action === 'status') {
        try {
          if (number === null) {
            const rows = ctx.appeals.listOwned(interaction.user.id);
            await interaction.reply({
              ephemeral: true,
              content: rows.length ? `Your recent appeals: ${rows.map((row) => `#${row.id} (${row.status})`).join(' · ')}` : 'You have not submitted any appeals.',
              embeds: rows.length ? [statusEmbed(rows[0])] : []
            });
            return;
          }
          const appeal = ctx.appeals.getStatus(number, interaction.user.id);
          await interaction.reply({
            ephemeral: true,
            embeds: [statusEmbed(appeal)]
          });
        } catch (err) {
          if (err.message === 'APPEAL_NOT_FOUND') {
            await interaction.reply({ content: 'Appeal not found. Appeal numbers are private to the person who submitted them.', ephemeral: true });
            return;
          }
          throw err;
        }
        return;
      }

      if (action === 'add') {
        await interaction.deferReply({ ephemeral: true });
        try {
          await ctx.appeals.addMessage(number, interaction.user.id, userInput('message'), interaction.guild);
          await interaction.editReply({ content: `Added information to appeal #${number}.` });
        } catch (err) {
          await interaction.editReply({ content: appealErrorMessage(err) });
        }
        return;
      }

      if (action === 'withdraw' || action === 'cancel') {
        await interaction.deferReply({ ephemeral: true });
        try {
          const appeal = await ctx.appeals.withdraw(
            number,
            interaction.user.id,
            interaction.guild
          );
          await interaction.editReply({ content: `Appeal #${appeal.id} for case ${appeal.case_id} has been withdrawn.` });
        } catch (err) {
          if (err.message === 'APPEAL_NOT_FOUND') {
            await interaction.editReply({ content: 'Appeal not found or it does not belong to you.' });
            return;
          }
          if (err.message === 'APPEAL_CLOSED') {
            await interaction.editReply({ content: 'That appeal is no longer open and cannot be withdrawn.' });
            return;
          }
          throw err;
        }
        return;
      }

      if (action === 'list') {
        const filter = userInput('status');
        const rows = ctx.appeals.list(filter === 'all' ? undefined : filter, 20);
        await interaction.reply({
          ephemeral: true,
          content: rows.length ? rows.map((row) => `#${row.id} · ${row.status} · case ${row.case_id} · <@${row.discord_id}>${row.assigned_to ? ` · assigned <@${row.assigned_to}>` : ''}`).join('\n').slice(0, 1900) : 'No appeals found.',
          allowedMentions: { parse: [] }
        });
        return;
      }

      if (action === 'view') {
        const details = ctx.appeals.getDetails(number);
        if (!details) {
          await interaction.reply({ content: 'Appeal not found.', ephemeral: true });
          return;
        }
        const { appeal, punishment, notes } = details;
        await interaction.reply({
          ephemeral: true,
          embeds: [embed(ctx.db, {
            title: `Appeal #${appeal.id} · ${appeal.status}`,
            description: appeal.explanation.slice(0, 1000),
            fields: [
              { name: 'Case / player', value: `${appeal.case_id} · ${punishment?.target_name || 'unknown'}`, inline: true },
              { name: 'Punishment', value: `${punishment?.type || 'unknown'} · ${punishment?.reason || 'no reason recorded'}`.slice(0, 1000), inline: true },
              { name: 'Requester / assigned staff', value: `<@${appeal.discord_id}> · ${appeal.assigned_to ? `<@${appeal.assigned_to}>` : 'unassigned'}` },
              ...(appeal.decision_reason ? [{ name: 'Latest decision note', value: appeal.decision_reason.slice(0, 1000) }] : []),
              ...(notes.length ? [{ name: 'Private staff notes', value: notes.map((note) => `<@${note.staff_id}>: ${note.note}`).join('\n').slice(0, 1000) }] : [])
            ]
          })]
        });
        return;
      }

      if (action === 'note') {
        try {
          ctx.appeals.addStaffNote(number, interaction.user.id, userInput('text'));
          await interaction.reply({ content: `Private note saved to appeal #${number}.`, ephemeral: true });
        } catch (err) {
          await interaction.reply({ content: appealErrorMessage(err), ephemeral: true });
        }
        return;
      }

      if (action === 'assign') {
        try {
          const assignee = interaction.options.getUser('staff', true);
          const member = await interaction.guild.members.fetch(assignee.id).catch(() => null);
          if (!member || !requireTier(member, ctx.db, 'mod')) {
            await interaction.reply({ content: 'Choose a current server member with the Mod role or higher.', ephemeral: true });
            return;
          }
          const details = ctx.appeals.getDetails(number);
          if (!details) {
            await interaction.reply({ content: 'Appeal not found.', ephemeral: true });
            return;
          }
          if (details.appeal.channel_id) {
            const channel = await interaction.guild.channels.fetch(details.appeal.channel_id);
            await channel.permissionOverwrites.edit(assignee.id, {
              ViewChannel: true, SendMessages: true, ReadMessageHistory: true
            });
          }
          ctx.appeals.assign(number, interaction.user.id, assignee.id);
          await interaction.reply({ content: `Appeal #${number} assigned to <@${assignee.id}>.`, ephemeral: true });
        } catch (err) {
          await interaction.reply({ content: appealErrorMessage(err), ephemeral: true });
        }
        return;
      }

      if (action === 'close') {
        await interaction.deferReply({ ephemeral: true });
        try {
          const appeal = await ctx.appeals.close(number, interaction.user.id, interaction.guild);
          await interaction.editReply({ content: `Appeal #${appeal.id} closed and archived.` });
        } catch (err) {
          await interaction.editReply({ content: appealErrorMessage(err) });
        }
        return;
      }

      if (action === 'history') {
        const { punishments, appeals } = ctx.appeals.history(userInput('ign'));
        await interaction.reply({
          ephemeral: true,
          content: `History for **${userInput('ign')}**\nPunishments: ${punishments.length ? punishments.map((row) => `${row.case_id} ${row.type} (${row.active ? 'active' : 'inactive'})`).join(' · ') : 'none'}\nAppeals: ${appeals.length ? appeals.map((row) => `#${row.id} (${row.status})`).join(' · ') : 'none'}`.slice(0, 1900)
        });
        return;
      }

      if (['accept', 'deny', 'reduce'].includes(action)) {
        const reason = action === 'accept' ? (userInput('note') || 'Accepted after staff review.') : userInput('reason');
        await interaction.deferReply({ ephemeral: true });
        try {
          const result = action === 'reduce'
            ? await ctx.appeals.voteReduction(number, interaction.user.id, userInput('duration'), reason)
            : await ctx.appeals.vote(number, interaction.user.id, action === 'accept', reason, interaction.guild);
          const final = ['accepted', 'denied', 'reduced'].includes(result.status);
          let channelUpdated = true;
          if (final) {
            try {
              await finalizeAppealChannel(ctx, interaction.guild, number, result.status, reason);
            } catch (err) {
              channelUpdated = false;
              logger.error({ err, appealId: number, status: result.status }, 'appeal decision finalized but channel update failed');
            }
          }
          const dmDelivered = final
            ? await sendAppealDecisionDm(ctx, interaction.user.id, ctx.appeals.getDetails(number)?.appeal, result.status, reason, result.duration)
            : null;
          await interaction.editReply({
            content: `Your ${action} vote was ${final ? `finalized as ${result.status}` : 'recorded'}. Votes: ${result.acceptCount} accept/reduce, ${result.denyCount} deny; ${result.requiredVotes} matching votes required.${action === 'reduce' ? ` Requested duration: ${result.duration}.` : ''}${final && !dmDelivered ? ' The requester could not be DMed.' : ''}${final && !channelUpdated ? ' The appeal channel could not be updated; check bot permissions.' : ''}`
          });
        } catch (err) {
          await interaction.editReply({ content: appealErrorMessage(err) });
        }
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      try {
        const { channel, id, punish, duplicate } = await ctx.appeals.open({
          guild: interaction.guild,
          user: interaction.user,
          caseId: userInput('case_id'),
          username: userInput('ign'),
          explanation: userInput('reason')
        });
        if (duplicate) {
          await interaction.editReply({
            content: channel
              ? `You already have an open appeal for this case: Appeal #${id} in ${channel}. Use \`/appeal status\` to check it.`
              : `Appeal #${id} already exists, but its channel is unavailable. Contact staff and provide this appeal number.`
          });
          return;
        }
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`appeal_accept:${id}`).setLabel('Accept appeal').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`appeal_deny:${id}`).setLabel('Deny appeal').setStyle(ButtonStyle.Danger)
        );
        await channel.send({
          content: `<@${interaction.user.id}>`,
          embeds: [embed(ctx.db, {
            title: `Appeal #${id} · Case ${punish.case_id}`,
            description: userInput('reason'),
            fields: [
              { name: 'Punishment', value: punish.type, inline: true },
              { name: 'Player', value: punish.target_name || `<@${interaction.user.id}>`, inline: true },
              { name: 'Review threshold', value: `${ctx.db.config.get('appeal_min_votes') || 2} staff votes`, inline: true },
              { name: 'Status', value: 'Open · awaiting staff review', inline: false }
            ]
          })],
          components: [row]
        });
        ctx.staffLog.add({
          actorId: interaction.user.id,
          targetDiscordId: interaction.user.id,
          targetName: punish.target_name,
          action: 'appeal_submit',
          reason: `Appeal #${id}: ${userInput('reason')}`,
          result: channel.id,
          caseId: punish.case_id,
          metadata: { appealId: id, punishmentType: punish.type }
        });
        await interaction.editReply({ content: `Appeal #${id} opened in ${channel}. Use \`/appeal status\` to follow it.` });
      } catch (err) {
        if (err.message === 'NO_CASE') {
          await interaction.editReply({ content: t(ctx.db, 'appeal.missing') });
          return;
        }
        if (err.message === 'NOT_CASE_OWNER') {
          await interaction.editReply({ content: 'You can only appeal a punishment issued to your Discord account or linked Minecraft account.' });
          return;
        }
        if (err.message === 'NOT_APPEALABLE') {
          await interaction.editReply({ content: 'Only active bans and mutes can be appealed.' });
          return;
        }
        if (err.message === 'APPEAL_ALREADY_DECIDED') {
          await interaction.editReply({ content: 'This punishment already has a decided appeal. Contact staff if you believe it needs further review.' });
          return;
        }
        if (err.message === 'INVALID_APPEAL') {
          await interaction.editReply({ content: 'Provide your Minecraft username or punishment case ID, plus a reason of up to 1000 characters.' });
          return;
        }
        await interaction.editReply({ content: appealErrorMessage(err) });
      }
    }
  }
];

function appealErrorMessage(err) {
  const messages = {
    APPEAL_NOT_FOUND: 'Appeal not found or it does not belong to you.',
    APPEAL_CLOSED: 'That appeal is no longer open.',
    APPEAL_CHANNEL_MISSING: 'The appeal channel is missing; contact staff to restore it.',
    NO_CASE: 'No active ban or mute was found for that punishment case or username.',
    NOT_CASE_OWNER: 'You can only appeal a punishment issued to your Discord account or linked Minecraft account.',
    NOT_APPEALABLE: 'Only active bans and mutes can be appealed.',
    APPEAL_ALREADY_DECIDED: 'This punishment already has a decided appeal. Contact staff if it needs another review.',
    INVALID_APPEAL: 'Provide your Minecraft username or punishment case ID, plus a reason of up to 1000 characters.',
    INVALID_APPEAL_MESSAGE: 'Your additional information must be between 1 and 1000 characters.',
    INVALID_APPEAL_NOTE: 'A private note must be between 1 and 1000 characters.',
    CLOSED: 'This appeal is no longer open for voting.',
    INVALID_DECISION_REASON: 'Decision notes must be between 10 and 1000 characters.',
    DECISION_ACTION_MISMATCH: 'Votes have already started for a different decision action on this appeal.',
    REDUCTION_DURATION_MISMATCH: 'A different reduced duration is already under consideration; use that same duration or wait for the decision to finish.',
    TEMPBAN_NOT_REDUCIBLE: 'Only an active temporary Minecraft ban can be reduced.',
    INVALID_REDUCED_DURATION: 'The new duration must be valid and shorter than the remaining ban.',
    INVALID_TARGET_NAME: 'The Minecraft username cannot safely be used in an AdvancedBan command.',
    SERVER_NOT_CONFIGURED: 'No Minecraft server is configured for RCON actions.',
    ADVANCEDBAN_COMMAND_FAILED: 'AdvancedBan rejected the command (for example because of permissions, duration limits, or current ban state). The appeal was not marked complete.',
    ADVANCEDBAN_UNCONFIRMED: 'AdvancedBan did not return its expected success message, so the appeal was not marked complete. Staff should verify the ban state before retrying.'
  };
  if (messages[err.message]) return messages[err.message];
  logger.error({ err }, 'appeal command failed');
  return 'The appeal action failed. The error was logged for staff; check RCON and bot permissions if this was an in-game action.';
}

async function finalizeAppealChannel(ctx, guild, appealId, status, reason) {
  const details = ctx.appeals.getDetails(appealId);
  const appeal = details?.appeal;
  if (!appeal?.channel_id) return;
  const channel = await guild.channels.fetch(appeal.channel_id);
  await channel.setTopic(`Appeal #${appeal.id} ${status} · Case ${appeal.case_id}`);
  await channel.permissionOverwrites.edit(appeal.discord_id, { SendMessages: false });
  const messages = await channel.messages.fetch({ limit: 100 });
  for (const message of messages.values()) {
    const hasAppealButtons = message.components.some((row) => row.components.some((component) =>
      /^appeal_(accept|deny):\d+$/.test(component.customId || '')
    ));
    if (hasAppealButtons) await message.edit({ components: [] });
  }
  await channel.send({
    content: `Appeal #${appeal.id} **${status}**. Decision note: ${reason}`,
    allowedMentions: { parse: [] }
  });
}

async function sendAppealDecisionDm(ctx, staffId, appeal, status, reason, duration) {
  if (!appeal) return false;
  try {
    const user = await ctx.client.users.fetch(appeal.discord_id);
    await user.send(`Your appeal #${appeal.id} for case ${appeal.case_id} was **${status}**.${duration ? ` New temporary-ban duration: ${duration}.` : ''} Staff note: ${reason}`);
    return true;
  } catch (err) {
    logger.warn({ err, appealId: appeal.id, staffId }, 'could not DM appeal requester about decision');
    return false;
  }
}

function appealDecisionModal(appealId, accept, messageId) {
  return new ModalBuilder()
    .setCustomId(`appeal_decision:${appealId}:${accept ? 'accept' : 'deny'}:${messageId}`)
    .setTitle(`${accept ? 'Accept' : 'Deny'} appeal #${appealId}`)
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('decision_reason')
        .setLabel('Decision reason (10-1000 characters)')
        .setStyle(TextInputStyle.Paragraph)
        .setMinLength(10)
        .setMaxLength(1000)
        .setRequired(true)
    ));
}

module.exports.appealDecisionModal = appealDecisionModal;
