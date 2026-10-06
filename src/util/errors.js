const { logger, requestId } = require('../logger');
const { t } = require('../i18n');

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

function installProcessHandlers(env) {
  process.on('unhandledRejection', (err) => {
    logger.error({ err, rid: requestId() }, 'unhandledRejection');
    sendErrorWebhook(env, err, { type: 'unhandledRejection' });
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException');
    sendErrorWebhook(env, err, { type: 'uncaughtException' }).finally(() => process.exit(1));
  });
}

async function replyError(interaction, db, err) {
  logger.error({ err, user: interaction.user?.id, command: interaction.commandName }, 'command failed');
  const msg = t(db, 'generic.error');
  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({ content: msg }).catch((replyErr) => {
      logger.warn({ err: replyErr, command: interaction.commandName }, 'failed to send command error response');
    });
  } else if (interaction.replied) {
    await interaction.followUp({ content: msg, ephemeral: true }).catch(() => {});
  } else {
    await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
  }
}

module.exports = { sendErrorWebhook, installProcessHandlers, replyError };
