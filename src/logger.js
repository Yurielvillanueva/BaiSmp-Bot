const pino = require('pino');

const redactPaths = [
  'password',
  'token',
  'secret',
  'rconPassword',
  'authorization',
  'cookie',
  '*.password',
  '*.token',
  '*.secret'
];

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: { paths: redactPaths, censor: '[redacted]' },
  mixin() {
    return {};
  },
  timestamp: pino.stdTimeFunctions.isoTime
});

function child(bindings) {
  return logger.child(bindings);
}

function requestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = { logger, child, requestId };
