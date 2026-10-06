const { hmacSha256, timingSafeEqualHex } = require('../util/crypto');
const { logger, requestId } = require('../logger');

function sign(secret, timestamp, body) {
  return hmacSha256(secret, `${timestamp}.${body}`);
}

function verifySignature(env, headers, rawBody) {
  const ts = headers['x-timestamp'];
  const sig = headers['x-signature'];
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() - Number(ts)) > 30_000) return false;
  const expected = sign(env.HMAC_SHARED_SECRET, ts, rawBody);
  return timingSafeEqualHex(expected, sig);
}

async function pluginRequest(env, server, method, pathname, bodyObj) {
  const rid = requestId();
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const ts = String(Date.now());
  const signature = sign(env.HMAC_SHARED_SECRET, ts, body);
  const url = `${server.plugin_api_url.replace(/\/$/, '')}${pathname}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), env.PLUGIN_API_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Timestamp': ts,
        'X-Signature': signature,
        'X-Request-Id': rid
      },
      body: method === 'GET' ? undefined : body,
      signal: ctrl.signal
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`plugin ${res.status}`);
    }
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}

async function pluginGet(env, server, pathname) {
  return pluginRequest(env, server, 'GET', pathname);
}

async function pluginPost(env, server, pathname, body) {
  return pluginRequest(env, server, 'POST', pathname, body);
}

function wrapPluginWebhook(env, db, handler) {
  return async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!verifySignature(env, req.headers, raw)) {
      logger.warn({ rid: requestId() }, 'plugin webhook bad signature');
      res.writeHead(401);
      res.end('unauthorized');
      return;
    }
    try {
      const json = raw ? JSON.parse(raw) : {};
      await handler(json, req, res);
    } catch (err) {
      logger.error({ err }, 'plugin webhook handler failed');
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('error');
      }
    }
  };
}

module.exports = { pluginGet, pluginPost, verifySignature, wrapPluginWebhook, sign };
