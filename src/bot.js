const {
  Client, GatewayIntentBits, Partials, Events, Collection, ActivityType
} = require('discord.js');
const { loadCommands } = require('./commands');
const { handleInteraction } = require('./events/interactions');
const { rateLimit } = require('./util/ratelimit');
const { replyError } = require('./util/errors');
const { isStaff, requireTier, memberTier } = require('./util/staff');
const { t } = require('./i18n');
const { logger } = require('./logger');
const { inviteOrSpam, maybeRaidLock, verificationGate } = require('./services/antiAbuse');
const { inc } = require('./http/server');

function createClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
  });
}

function attachBot(ctx) {
  const { client, db } = ctx;
  const commands = loadCommands();
  client.commands = new Collection();
  for (const cmd of commands) client.commands.set(cmd.data.name, cmd);

  ctx.requireStaff = async (interaction, min) => {
    if (requireTier(interaction.member, db, min)) return true;
    await interaction.reply({ content: t(db, 'generic.no_permission'), ephemeral: true });
    return false;
  };

  client.once(Events.ClientReady, async (c) => {
    logger.info({ user: c.user.tag }, 'discord ready');
    await ctx.status.tick().catch((err) => logger.error({ err }, 'initial status'));
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        if (!rateLimit(interaction.user.id)) {
          await interaction.reply({ content: t(db, 'generic.rate_limited'), ephemeral: true });
          return;
        }
        const cmd = client.commands.get(interaction.commandName);
        if (!cmd) {
          logger.error({
            commandName: interaction.commandName,
            registeredCommands: [...client.commands.keys()]
          }, 'received unregistered slash command');
          await interaction.reply({
            content: 'This command is no longer available. Please try again or ask an administrator to redeploy commands.',
            ephemeral: true
          });
          return;
        }
        if (cmd.staff && !requireTier(interaction.member, db, cmd.staff)) {
          await interaction.reply({ content: t(db, 'generic.no_permission'), ephemeral: true });
          return;
        }
        inc('commands');
        await cmd.execute(interaction, ctx);
        return;
      }
      await handleInteraction(interaction, ctx);
    } catch (err) {
      inc('errors');
      await replyError(interaction, ctx, err);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (!message.guild || message.author.bot) return;
    ctx.tickets.touch(message.channel.id);
    const flag = inviteOrSpam(message.content, db);
    if (flag && !isStaff(message.member, db)) {
      await message.delete().catch(() => {});
      await message.channel.send({ content: `<@${message.author.id}> that message was blocked (${flag}).` }).catch(() => {});
      return;
    }
    await ctx.chatBridge.fromDiscord(message);
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    await verificationGate(ctx, member);
    await maybeRaidLock(ctx, member);
  });

  client.on(Events.GuildMemberUpdate, async (oldM, newM) => {
    if (oldM.roles.cache.size !== newM.roles.cache.size) {
      await ctx.ranks.discordToLp(newM).catch(() => {});
    }
    if (!oldM.premiumSince && newM.premiumSince) {
      const linked = ctx.links.getByDiscord(newM.id)[0];
      if (linked) await ctx.rewards.booster(linked.minecraft_uuid);
    }
  });

  void ActivityType;
  void memberTier;
  return commands;
}

module.exports = { createClient, attachBot };
