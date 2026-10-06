const hits = new Map();

function rateLimit(userId, max = 8, windowMs = 10000) {
  const now = Date.now();
  const rec = hits.get(userId) || [];
  const recent = rec.filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  return true;
}

module.exports = { rateLimit };
