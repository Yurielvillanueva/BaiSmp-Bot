const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { logger } = require('../logger');
const { cfg } = require('../config/store');
const { pingServer } = require('../services/status');

function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(16).toString('hex');
  return req.session.csrf;
}

function requireCsrf(req, res, next) {
  if (req.method === 'GET') return next();
  if (req.body?._csrf && req.body._csrf === req.session.csrf) return next();
  res.status(403).send('CSRF rejected');
}

function startDashboard(ctx) {
  const { env, db } = ctx;
  const app = express();
  app.use(helmet());
  app.use(express.urlencoded({ extended: true }));
  app.use(rateLimit({ windowMs: 60_000, max: 120 }));
  app.use(session({
    name: 'mcbridge.sid',
    secret: env.DASHBOARD_SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 3600 * 1000 }
  }));
  app.use(requireCsrf);

  function admin(req) {
    return Boolean(req.session.user && req.session.staff);
  }

  app.get('/auth/login', (_req, res) => {
    const url = new URL('https://discord.com/api/oauth2/authorize');
    url.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
    url.searchParams.set('redirect_uri', env.OAUTH_REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify guilds.members.read');
    res.redirect(url.toString());
  });

  app.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    const body = new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.OAUTH_REDIRECT_URI
    });
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const token = await tokenRes.json();
    const meRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
    const me = await meRes.json();
    const memberRes = await fetch(`https://discord.com/api/guilds/${env.DISCORD_GUILD_ID}/members/${me.id}`, {
      headers: { Authorization: `Bot ${env.DISCORD_TOKEN}` }
    });
    const member = await memberRes.json();
    const roles = member.roles || [];
    const staff = [cfg(db, 'admin_role_id'), cfg(db, 'owner_role_id'), cfg(db, 'mod_role_id')].filter(Boolean).some((r) => roles.includes(r));
    req.session.user = { id: me.id, username: me.username };
    req.session.staff = staff;
    req.session.created = Date.now();
    res.redirect('/');
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/auth')) return next();
    if (!req.session.user) return res.redirect('/auth/login');
    if (Date.now() - (req.session.created || 0) > 8 * 3600 * 1000) {
      req.session.destroy(() => {});
      return res.redirect('/auth/login');
    }
    next();
  });

  app.get('/', async (req, res) => {
    const servers = db.servers.all();
    const statuses = [];
    for (const s of servers) statuses.push({ name: s.name, ...(await pingServer(s)) });
    res.send(page('Status', req, `<h1>Live status</h1>${statuses.map((s) => `<p>${s.name}: ${s.online ? 'online' : 'offline'} ${s.players}/${s.max}</p>`).join('')}`));
  });

  app.get('/logbook', (req, res) => {
    if (!admin(req)) return res.status(403).send('Staff only');
    const q = String(req.query.q || '');
    const rows = ctx.staffLog.search({ query: q, limit: 100 });
    res.send(page('Log book', req, `<form><input name="q" value="${esc(q)}"><button>Search</button></form>
      <table>${rows.map((r) => `<tr><td>${esc(r.case_id)}</td><td>${esc(r.action)}</td><td>${esc(r.target_name)}</td><td>${esc(r.reason)}</td></tr>`).join('')}</table>`));
  });

  app.get('/tickets', (req, res) => {
    if (!admin(req)) return res.status(403).send('Staff only');
    const rows = ctx.tickets.listOpen();
    res.send(page('Tickets', req, rows.map((t) => `<p>#${t.number} ${esc(t.mc_name)} ${esc(t.status)}</p>`).join('')));
  });

  app.get('/stats', async (req, res) => {
    const name = String(req.query.player || '');
    let body = '<form><input name="player"><button>Load</button></form>';
    if (name) {
      const acc = db.raw.prepare('SELECT * FROM linked_accounts WHERE username = ? COLLATE NOCASE').get(name);
      try {
        const s = await ctx.stats.forPlayer(name, acc?.minecraft_uuid);
        body += `<p>Playtime ${s.playtimeMin} deaths ${s.deaths} kills ${s.mobKills}</p>`;
      } catch {
        body += '<p>No stats</p>';
      }
    }
    res.send(page('Stats', req, body));
  });

  app.get('/admin/config', (req, res) => {
    if (!admin(req)) return res.status(403).send('Staff only');
    const all = db.config.getAll();
    const rows = Object.entries(all).map(([k, v]) => `<form method="post" action="/admin/config"><input type="hidden" name="_csrf" value="${csrfToken(req)}">
      <label>${esc(k)}</label><textarea name="value">${esc(typeof v === 'string' ? v : JSON.stringify(v))}</textarea>
      <input type="hidden" name="key" value="${esc(k)}"><button>Save</button></form>`).join('');
    const alerts = require('../services/alerts').EVENT_TYPES.map((e) => `<form method="post" action="/admin/alerts"><input type="hidden" name="_csrf" value="${csrfToken(req)}">
      ${e} <input name="channel" placeholder="channel id"><button name="event" value="${e}">Route</button></form>`).join('');
    res.send(page('Config', req, rows + '<h2>Alerts</h2>' + alerts));
  });

  app.post('/admin/config', (req, res) => {
    if (!admin(req)) return res.status(403).send('Staff only');
    let value = req.body.value;
    try { value = JSON.parse(value); } catch { /* string */ }
    db.config.set(req.body.key, value, req.session.user.id);
    res.redirect('/admin/config');
  });

  app.post('/admin/alerts', (req, res) => {
    if (!admin(req)) return res.status(403).send('Staff only');
    const server = db.servers.all()[0];
    require('../services/alerts').setAlert(db, server.id, req.body.event, true, req.body.channel);
    res.redirect('/admin/config');
  });

  app.listen(env.BOT_HTTP_PORT + 1, '127.0.0.1', () => logger.info({ port: env.BOT_HTTP_PORT + 1 }, 'dashboard listening'));
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page(title, req, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>body{font-family:sans-serif;max-width:960px;margin:2rem auto;background:#111;color:#eee}a{color:#8cf}textarea{width:100%;height:4rem}</style></head>
    <body><nav><a href="/">Status</a> <a href="/logbook">Log book</a> <a href="/tickets">Tickets</a> <a href="/stats">Stats</a> <a href="/admin/config">Config</a></nav>
    ${body}</body></html>`;
}

module.exports = { startDashboard };
