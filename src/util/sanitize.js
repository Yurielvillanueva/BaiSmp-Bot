const IP_RE = /\b(?:(?:\d{1,3}\.){3}\d{1,3}|[a-fA-F0-9:]{8,})\b/g;
const COLOR_RE = /(?:§[0-9A-FK-ORa-fk-or]|[\u00A7][0-9A-FK-ORa-fk-or]|\x1B\[[0-9;]*m)/g;
const DANGEROUS_RCON = /[\n\r\0]|\$\(|`/;

function stripColorCodes(text) {
  return String(text || '').replace(COLOR_RE, '');
}

function maskIps(text) {
  return String(text || '').replace(IP_RE, '[ip]');
}

function sanitizeLogLine(text) {
  return maskIps(stripColorCodes(text)).slice(0, 1800);
}

function sanitizeRconCommand(raw) {
  const cmd = String(raw || '').trim();
  if (!cmd || cmd.length > 256) {
    throw new Error('Command is empty or too long');
  }
  if (DANGEROUS_RCON.test(cmd)) {
    throw new Error('Command contains forbidden characters');
  }
  if (cmd.startsWith('/')) {
    return cmd.slice(1);
  }
  return cmd;
}

function parseDuration(input) {
  const match = String(input || '').trim().match(/^(\d+)(s|m|h|d|w)$/i);
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  const map = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  return n * map[unit];
}

function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function chunkText(text, size = 1900) {
  const src = String(text || '');
  const chunks = [];
  for (let i = 0; i < src.length; i += size) {
    chunks.push(src.slice(i, i + size));
  }
  return chunks.length ? chunks : [''];
}

function floodgateName(username, prefix) {
  const name = String(username || '').trim();
  if (!name) return name;
  if (prefix && name.startsWith(prefix)) return name;
  return name;
}

module.exports = {
  stripColorCodes,
  maskIps,
  sanitizeLogLine,
  sanitizeRconCommand,
  parseDuration,
  formatDuration,
  chunkText,
  floodgateName
};
