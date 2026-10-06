module.exports = {
  apps: [{
    name: 'mc-discord-bridge',
    script: 'src/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: { NODE_ENV: 'production' },
    error_file: 'logs/pm2-error.log',
    out_file: 'logs/pm2-out.log'
  }]
};
