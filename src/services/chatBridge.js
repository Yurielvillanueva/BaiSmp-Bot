const { sendRcon } = require('./rcon');
const { cfg } = require('../config/store');
const { maskIps, stripColorCodes } = require('../util/sanitize');
const { logger } = require('../logger');

function createChatBridge(ctx) {
  const { db, env } = ctx;

  return {
    enabled() {
      return Boolean(cfg(db, 'chat_bridge_enabled'));
    },
    async fromDiscord(message) {
      if (!this.enabled()) return;
      const server = db.servers.all().find((s) => s.chat_channel_id === message.channel.id);
      if (!server || message.author.bot) return;
      const text = stripColorCodes(maskIps(message.cleanContent)).slice(0, 200);
      if (!text) return;
      await sendRcon(env, db, server, `say [Discord] ${message.member?.displayName || message.author.username}: ${text}`)
        .catch((err) => logger.debug({ err: err.message }, 'chat bridge rcon'));
    },
    async fromMinecraft(client, server, username, message) {
      if (!this.enabled() || !server.chat_channel_id) return;
      const channel = await client.channels.fetch(server.chat_channel_id).catch(() => null);
      if (!channel) return;
      await channel.send(`**${username}**: ${stripColorCodes(maskIps(message)).slice(0, 300)}`);
    }
  };
}

module.exports = { createChatBridge };
