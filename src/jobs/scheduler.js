const cron = require('node-cron');
const { logger } = require('../logger');
const { sendRcon } = require('../services/rcon');
const { embed } = require('../util/embeds');

function startScheduler(ctx) {
  const jobs = [];

  jobs.push(setInterval(() => ctx.status.tick().catch((err) => logger.error({ err }, 'status tick')), ctx.env.STATUS_INTERVAL_MS));
  jobs.push(setInterval(() => {
    for (const s of ctx.db.servers.all()) ctx.perf.sample(s).catch(() => {});
  }, ctx.env.PERF_INTERVAL_MS));

  const lift = cron.schedule('* * * * *', async () => {
    const guild = await ctx.client.guilds.fetch(ctx.env.DISCORD_GUILD_ID);
    await ctx.moderation.liftExpired(guild);
    await ctx.tickets.closeIdle();
    const { hour, five } = ctx.events.dueReminders();
    for (const ev of hour) {
      const ch = ctx.db.servers.all()[0]?.alert_channel_id;
      if (ch) {
        const channel = await ctx.client.channels.fetch(ch).catch(() => null);
        if (channel) await channel.send({ embeds: [embed(ctx.db, { title: 'Event in 1 hour', description: ev.name })] });
      }
      ctx.events.mark(ev.id, 'reminded_1h');
    }
    for (const ev of five) {
      const ch = ctx.db.servers.all()[0]?.alert_channel_id;
      if (ch) {
        const channel = await ctx.client.channels.fetch(ch).catch(() => null);
        if (channel) await channel.send({ embeds: [embed(ctx.db, { title: 'Event in 5 minutes', description: ev.name })] });
      }
      ctx.events.mark(ev.id, 'reminded_5m');
    }
    for (const g of ctx.events.dueGiveaways()) {
      const winners = await ctx.events.pickWinners(g);
      const channel = await ctx.client.channels.fetch(g.channel_id).catch(() => null);
      if (channel) await channel.send(`Giveaway **${g.prize}** winners: ${winners.map((id) => `<@${id}>`).join(', ') || 'none'}`);
    }
  });

  const names = cron.schedule('0 */6 * * *', async () => {
    for (const row of ctx.db.raw.prepare('SELECT * FROM linked_accounts').all()) {
      await ctx.links.refreshUsername(row).catch(() => {});
    }
  });

  const stored = ctx.db.raw.prepare('SELECT * FROM scheduled_jobs WHERE enabled = 1').all();
  const extra = [];
  for (const job of stored) {
    extra.push(cron.schedule(job.cron_expr, async () => {
      const payload = JSON.parse(job.payload);
      const server = ctx.db.servers.getByName(payload.server) || ctx.db.servers.all()[0];
      if (job.kind === 'announce' && payload.message) {
        await sendRcon(ctx.env, ctx.db, server, `say ${payload.message}`).catch(() => {});
      }
      if (job.kind === 'restart_warning') {
        await sendRcon(ctx.env, ctx.db, server, `say ${payload.message || 'Scheduled restart soon'}`).catch(() => {});
      }
      if (job.kind === 'backup') {
        await ctx.backups.run(server, 'cron').catch((err) => logger.error({ err }, 'scheduled backup'));
      }
    }));
  }

  return {
    stop() {
      for (const j of jobs) clearInterval(j);
      lift.stop();
      names.stop();
      extra.forEach((j) => j.stop());
    }
  };
}

module.exports = { startScheduler };
