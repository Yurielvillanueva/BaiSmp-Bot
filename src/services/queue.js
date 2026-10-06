const { Queue, Worker, Job } = require('bullmq');
const { logger } = require('../logger');

let queue = null;
let worker = null;

function createQueue(env) {
  if (!env.REDIS_QUEUE_HOST) {
    logger.info('Redis queue not configured, using in-memory fallback');
    return createInMemoryQueue();
  }

  const connection = {
    host: env.REDIS_QUEUE_HOST,
    port: env.REDIS_QUEUE_PORT || 6379,
    password: env.REDIS_QUEUE_PASSWORD || undefined,
    db: env.REDIS_QUEUE_DB || 1
  };

  queue = new Queue('mc-bridge', { connection });

  queue.on('error', (err) => {
    logger.error({ err }, 'Queue error');
  });

  return createQueueService(queue);
}

function createInMemoryQueue() {
  const jobs = new Map();
  let jobIdCounter = 0;

  return {
    async add(name, data, options = {}) {
      const id = String(++jobIdCounter);
      const job = { id, name, data, options, createdAt: Date.now() };
      jobs.set(id, job);

      if (options.delay) {
        setTimeout(() => this.processJob(job), options.delay);
      } else {
        setImmediate(() => this.processJob(job));
      }

      return { id };
    },

    async processJob(job) {
      if (job.name === 'send_discord_message') {
        // In-memory fallback: just log
        logger.info({ job }, 'Processing job (in-memory)');
      }
    },

    async getJob(id) {
      return jobs.get(id);
    },

    async remove(id) {
      jobs.delete(id);
    }
  };
}

function createQueueService(queue) {
  return {
    async addJob(name, data, options = {}) {
      const job = await queue.add(name, data, options);
      logger.info({ jobId: job.id, name }, 'Job added to queue');
      return job;
    },

    async addDelayedJob(name, data, delayMs) {
      return this.addJob(name, data, { delay: delayMs });
    },

    async addRecurringJob(name, data, cronPattern) {
      // BullMQ doesn't have built-in cron, use node-cron for this
      logger.info({ name, cronPattern }, 'Recurring job scheduled (via node-cron)');
    },

    async getJob(jobId) {
      return queue.getJob(jobId);
    },

    async removeJob(jobId) {
      const job = await this.getJob(jobId);
      if (job) {
        await job.remove();
      }
    },

    async getJobCounts() {
      return queue.getJobCounts();
    },

    async clean(grace = 5000, limit = 100) {
      await queue.clean(grace, limit);
    }
  };
}

function createWorker(env, handlers) {
  if (!env.REDIS_QUEUE_HOST) {
    logger.info('Redis queue not configured, worker not started');
    return null;
  }

  const connection = {
    host: env.REDIS_QUEUE_HOST,
    port: env.REDIS_QUEUE_PORT || 6379,
    password: env.REDIS_QUEUE_PASSWORD || undefined,
    db: env.REDIS_QUEUE_DB || 1
  };

  worker = new Worker('mc-bridge', async (job) => {
    const handler = handlers[job.name];
    if (handler) {
      await handler(job.data, job);
    } else {
      logger.warn({ jobName: job.name }, 'No handler for job');
    }
  }, { connection });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, name: job.name }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, name: job?.name, err }, 'Job failed');
  });

  return worker;
}

async function defaultHandlers(ctx) {
  return {
    async send_discord_message(data, job) {
      const { channelId, content, embed } = data;
      const channel = await ctx.client.channels.fetch(channelId).catch(() => null);
      if (channel) {
        if (embed) {
          await channel.send({ content, embeds: [embed] });
        } else {
          await channel.send(content);
        }
      }
    },

    async send_rcon_command(data, job) {
      const { serverId, command } = data;
      const server = ctx.db.servers.get(serverId);
      if (server) {
        const { sendRcon } = require('./rcon');
        await sendRcon(ctx.env, ctx.db, server, command);
      }
    },

    async process_anomaly(data, job) {
      const { anomalyId } = data;
      await ctx.anomalyDetection.resolveAnomaly(anomalyId);
    },

    async cleanup_old_backups(data, job) {
      const { serverId } = data;
      const server = ctx.db.servers.get(serverId);
      if (server) {
        ctx.backups.prune(server);
      }
    },

    async generate_report(data, job) {
      const { reportType, parameters } = data;
      // Report generation logic
      logger.info({ reportType, parameters }, 'Generating report');
    }
  };
}

module.exports = { createQueue, createWorker, defaultHandlers };
