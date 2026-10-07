const { logger, requestId } = require('../logger');
const { t } = require('../i18n');
const { embed } = require('./embeds');

async function notifyStaffError(ctx, error, metadata = {}) {
  const channelId = ctx.env.ERROR_CHANNEL_ID
    || ctx.db.config.get('staff_log_channel_id')
    || ctx.db.servers.all().find((server) => server.alert_channel_id)?.alert_channel_id;
  if (!channelId) {
    logger.error({ command: metadata.command, code: error?.code }, 'staff error notification unavailable: no error or staff log channel configured');
    return false;
  }

  try {
    const channel = await ctx.client.channels.fetch(channelId);
    if (!channel?.isTextBased() || typeof channel.send !== 'function') {
      logger.error({ channelId }, 'staff error notification unavailable: configured channel is not text-based');
      return false;
    }

    const roleId = ctx.env.ERROR_NOTIFY_ROLE_ID || ctx.env.HEAD_DEVELOPER_ROLE_ID;
    const fields = [
      { name: 'Command', value: String(metadata.command || 'Background process').slice(0, 100), inline: true },
      { name: 'User', value: metadata.userId ? `<@${metadata.userId}>` : 'System', inline: true },
      { name: 'Error', value: String(error?.message || error || 'Unknown error').slice(0, 1000), inline: false }
    ];
    await channel.send({
      content: roleId ? `<@&${roleId}>` : undefined,
      allowedMentions: { roles: roleId ? [roleId] : [], users: [], repliedUser: false },
      embeds: [embed(ctx.db, {
        title: 'Bot command error',
        description: 'A command failed. Review the error and bot logs.',
        fields,
        color: 0xe74c3c
      })]
    });
    return true;
  } catch (notifyError) {
    logger.error({ err: notifyError, channelId, command: metadata.command }, 'failed to notify staff about bot error');
    return false;
  }
}

async function sendErrorWebhook(env, error, context) {
  if (!env.ERROR_WEBHOOK_URL) return;
  try {
    await fetch(env.ERROR_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: null,
        embeds: [{
          title: 'Unhandled error',
          description: `\`\`\`${String(error?.stack || error).slice(0, 3900)}\`\`\``,
          fields: [{ name: 'context', value: JSON.stringify(context || {}).slice(0, 1000) }],
          timestamp: new Date().toISOString()
        }]
      })
    });
  } catch (err) {
    logger.warn({ err }, 'failed to send error webhook');
  }
}

function installProcessHandlers(env, getContext = () => null) {
  const notify = (error, metadata) => {
    const ctx = getContext();
    if (ctx) return notifyStaffError(ctx, error, metadata);
    logger.error({ code: error?.code }, 'staff error notification unavailable before bot initialization');
    return Promise.resolve(false);
  };
  process.on('unhandledRejection', (err) => {
    logger.error({ err, rid: requestId() }, 'unhandledRejection');
    void Promise.all([
      sendErrorWebhook(env, err, { type: 'unhandledRejection' }),
      notify(err, { command: 'Unhandled rejection' })
    ]);
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException');
    void Promise.all([
      sendErrorWebhook(env, err, { type: 'uncaughtException' }),
      notify(err, { command: 'Uncaught exception' })
    ]).finally(() => process.exit(1));
  });
}

async function replyError(interaction, ctx, err) {
  const { db } = ctx;
  const command = interaction.commandName || interaction.customId || 'Discord interaction';
  logger.error({ err, user: interaction.user?.id, command }, 'command failed');
  const msg = err?.code === 'BACKUP_WORLD_PATH_MISSING'
    ? 'Backup unavailable: configure MC_WORLD_PATH to a world folder the bot can access. For a remote host, run backups on that host or expose its world files securely.'
    : err?.code === 'BACKUP_WORLD_PATH_INVALID'
      ? 'Backup unavailable: MC_WORLD_PATH does not point to an accessible world directory. Check the configured path on the bot host.'
      : t(db, 'generic.error');
  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({ content: msg }).catch((replyErr) => {
      logger.warn({ err: replyErr, command: interaction.commandName }, 'failed to send command error response');
    });
  } else if (interaction.replied) {
    await interaction.followUp({ content: msg, ephemeral: true }).catch((replyErr) => {
      logger.warn({ err: replyErr, command: interaction.commandName }, 'failed to send command error follow-up');
    });
  } else {
    await interaction.reply({ content: msg, ephemeral: true }).catch((replyErr) => {
      logger.warn({ err: replyErr, command: interaction.commandName }, 'failed to send command error response');
    });
  }
  await notifyStaffError(ctx, err, { command, userId: interaction.user?.id });
}

module.exports = { sendErrorWebhook, installProcessHandlers, replyError, notifyStaffError };
