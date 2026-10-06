const { pluginGet } = require('./pluginClient');
const { cfg } = require('../config/store');
const { dispatchAlert } = require('./alerts');
const { logger } = require('../logger');

function createPerfService(ctx) {
  const { db, env } = ctx;

  return {
    async sample(server) {
      if (!server.plugin_api_url) return null;
      try {
        const data = await pluginGet(env, server, '/v1/perf');
        db.raw.prepare(`INSERT INTO perf_samples (server_id, tps, mspt, ram_used, ram_max, cpu, chunks, entities, lag_sources, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          server.id, data.tps, data.mspt, data.ramUsed, data.ramMax, data.cpu, data.chunks, data.entities,
          JSON.stringify(data.lagSources || []), Date.now()
        );
        const cutoff = Date.now() - 7 * 86400000;
        db.raw.prepare('DELETE FROM perf_samples WHERE created_at < ?').run(cutoff);
        if (data.tps != null && data.tps < cfg(db, 'tps_alert_threshold')) {
          await dispatchAlert(ctx, server, 'tps', {
            title: 'Low TPS',
            description: `TPS ${data.tps}. Top lag: ${(data.lagSources || []).slice(0, 5).join(', ') || 'n/a'}`
          });
        }
        if (data.ramUsed && data.ramMax && (data.ramUsed / data.ramMax) * 100 >= cfg(db, 'ram_alert_percent')) {
          await dispatchAlert(ctx, server, 'tps', {
            title: 'High RAM',
            description: `${Math.round((data.ramUsed / data.ramMax) * 100)}% used`
          });
        }
        return data;
      } catch (err) {
        logger.debug({ err: err.message }, 'perf sample failed');
        return null;
      }
    },
    history(serverId) {
      return db.raw.prepare('SELECT * FROM perf_samples WHERE server_id = ? AND created_at >= ? ORDER BY created_at ASC')
        .all(serverId, Date.now() - 7 * 86400000);
    }
  };
}

async function renderPerfChart(samples) {
  const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
  const canvas = new ChartJSNodeCanvas({ width: 900, height: 360, backgroundColour: '#1e1e1e' });
  return canvas.renderToBuffer({
    type: 'line',
    data: {
      labels: samples.map((s) => new Date(s.created_at).toISOString().slice(11, 16)),
      datasets: [
        { label: 'TPS', data: samples.map((s) => s.tps), borderColor: '#2ecc71', tension: 0.2 },
        { label: 'MSPT', data: samples.map((s) => s.mspt), borderColor: '#e67e22', tension: 0.2 }
      ]
    },
    options: { plugins: { legend: { labels: { color: '#fff' } } }, scales: { x: { ticks: { color: '#aaa' } }, y: { ticks: { color: '#aaa' } } } }
  });
}

module.exports = { createPerfService, renderPerfChart };
