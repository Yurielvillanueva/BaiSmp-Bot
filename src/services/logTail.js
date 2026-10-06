const fs = require('fs');
const { sanitizeLogLine, chunkText } = require('../util/sanitize');
const { logger } = require('../logger');

function createLogTail(ctx) {
  const { db, client, env } = ctx;
  const buffers = new Map();
  const offsets = new Map();
  let timer;

  function readNew(server) {
    const file = server.log_path || env.MC_LOG_PATH;
    if (!file || !fs.existsSync(file)) return;
    const stat = fs.statSync(file);
    const prev = offsets.get(server.id) || stat.size;
    if (stat.size < prev) offsets.set(server.id, 0);
    const start = offsets.get(server.id) ?? stat.size;
    if (stat.size <= start) {
      offsets.set(server.id, stat.size);
      return;
    }
    const fd = fs.openSync(file, 'r');
    const len = stat.size - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    fs.closeSync(fd);
    offsets.set(server.id, stat.size);
    const lines = buf.toString('utf8').split(/\r?\n/).filter(Boolean).map(sanitizeLogLine);
    const acc = buffers.get(server.id) || [];
    acc.push(...lines);
    buffers.set(server.id, acc);
  }

  async function flush() {
    for (const server of db.servers.all()) {
      const lines = buffers.get(server.id) || [];
      buffers.set(server.id, []);
      if (!lines.length || !server.console_channel_id) continue;
      const channel = await client.channels.fetch(server.console_channel_id).catch(() => null);
      if (!channel) continue;
      const text = lines.join('\n');
      for (const chunk of chunkText(text, 1900)) {
        if (chunk.trim()) await channel.send(`\`\`\`\n${chunk}\n\`\`\``).catch((err) => logger.debug({ err: err.message }, 'console send'));
      }
    }
  }

  function start() {
    timer = setInterval(async () => {
      for (const server of db.servers.all()) {
        try { readNew(server); } catch (err) { logger.debug({ err: err.message }, 'log tail'); }
      }
      await flush();
    }, env.LOG_TAIL_BATCH_MS);
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
  }

  return { start, stop };
}

module.exports = { createLogTail };
