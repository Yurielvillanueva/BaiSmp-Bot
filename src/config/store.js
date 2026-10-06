const DEFAULTS = {
  linked_role_id: '',
  whitelisted_role_id: '',
  helper_role_id: '',
  mod_role_id: '',
  admin_role_id: '',
  developer_role_id: '',
  head_developer_role_id: '',
  owner_role_id: '',
  muted_role_id: '',
  verified_role_id: '',
  staff_log_channel_id: '',
  ticket_category_id: '',
  ticket_log_channel_id: '',
  appeal_category_id: '',
  vote_channel_id: '',
  floodgate_prefix: '.',
  max_links_per_discord: 1,
  open_ticket_limit: 2,
  appeal_min_votes: 2,
  tps_alert_threshold: 16,
  ram_alert_percent: 90,
  raid_joins_per_minute: 12,
  account_age_hours: 24,
  daily_cooldown_hours: 20,
  backup_keep_last: 7,
  idle_ticket_hours: 48,
  link_code_ttl_minutes: 10,
  crash_fail_threshold: 3,
  locale: 'en',
  embed_color: 0x2ecc71,
  embed_footer: 'MC Bridge',
  rcon_kill_switch: false,
  chat_bridge_enabled: false,
  verification_gate: true,
  invite_filter: true,
  spam_filter: true,
  booster_reward_command: 'lp user {uuid} parent addtemp booster 30d',
  vote_reward_command: 'give {name} diamond 1',
  daily_reward_command: 'give {name} bread 8',
  escalation_warns: 3,
  escalation_window_days: 30,
  escalation_mute: '24h',
  rcon_allowlists: {
    helper: ['say', 'list', 'tps', 'whitelist list'],
    mod: ['say', 'list', 'tps', 'whitelist', 'kick', 'mute', 'tempban', 'pardon'],
    admin: ['say', 'list', 'tps', 'whitelist', 'kick', 'mute', 'tempban', 'pardon', 'ban', 'save-all', 'whitelist add', 'whitelist remove'],
    developer: ['say', 'list', 'tps', 'whitelist', 'kick', 'mute', 'tempban', 'pardon', 'ban', 'save-all', 'whitelist add', 'whitelist remove'],
    'head-developer': ['say', 'list', 'tps', 'whitelist', 'kick', 'mute', 'tempban', 'pardon', 'ban', 'save-all', 'whitelist add', 'whitelist remove', 'op'],
    owner: ['*']
  },
  rcon_blocked: ['stop', 'op', 'deop'],
  rcon_confirm: ['ban-ip', 'whitelist off', 'reload', 'restart'],
  theme: {
    color: 0x2ecc71,
    footer: 'MC Bridge'
  }
};

function seedConfigFromEnv(db, env) {
  const mapping = {
    linked_role_id: process.env.LINKED_ROLE_ID || '',
    whitelisted_role_id: process.env.WHITELISTED_ROLE_ID || '',
    helper_role_id: process.env.HELPER_ROLE_ID || '',
    mod_role_id: process.env.MOD_ROLE_ID || '',
    admin_role_id: process.env.ADMIN_ROLE_ID || '',
    developer_role_id: process.env.DEVELOPER_ROLE_ID || '',
    head_developer_role_id: process.env.HEAD_DEVELOPER_ROLE_ID || '',
    owner_role_id: process.env.OWNER_ROLE_ID || '',
    muted_role_id: process.env.MUTED_ROLE_ID || '',
    verified_role_id: process.env.VERIFIED_ROLE_ID || '',
    staff_log_channel_id: process.env.STAFF_LOG_CHANNEL_ID || '',
    ticket_category_id: process.env.TICKET_CATEGORY_ID || '',
    ticket_log_channel_id: process.env.TICKET_LOG_CHANNEL_ID || '',
    appeal_category_id: process.env.APPEAL_CATEGORY_ID || '',
    vote_channel_id: process.env.VOTE_CHANNEL_ID || '',
    floodgate_prefix: process.env.FLOODGATE_PREFIX || '.',
    max_links_per_discord: Number(process.env.MAX_LINKS_PER_DISCORD || 1),
    open_ticket_limit: Number(process.env.OPEN_TICKET_LIMIT || 2),
    appeal_min_votes: Number(process.env.APPEAL_MIN_VOTES || 2),
    tps_alert_threshold: Number(process.env.TPS_ALERT_THRESHOLD || 16),
    ram_alert_percent: Number(process.env.RAM_ALERT_PERCENT || 90),
    raid_joins_per_minute: Number(process.env.RAID_JOINS_PER_MINUTE || 12),
    account_age_hours: Number(process.env.ACCOUNT_AGE_HOURS || 24),
    daily_cooldown_hours: Number(process.env.DAILY_COOLDOWN_HOURS || 20),
    backup_keep_last: Number(process.env.BACKUP_KEEP_LAST || 7),
    idle_ticket_hours: Number(process.env.IDLE_TICKET_HOURS || 48),
    link_code_ttl_minutes: Number(process.env.LINK_CODE_TTL_MINUTES || 10),
    crash_fail_threshold: Number(process.env.CRASH_FAIL_THRESHOLD || 3)
  };
  for (const [key, def] of Object.entries({ ...DEFAULTS, ...mapping })) {
    const current = db.config.get(key);
    if (key === 'rcon_allowlists' && current && typeof current === 'object') {
      db.config.set(key, { ...def, ...current }, 'system');
    } else if (current === undefined || (current === '' && def !== '')) {
      db.config.set(key, def, 'system');
    }
  }
  void env;
}

function cfg(db, key) {
  const value = db.config.get(key);
  return value === undefined ? DEFAULTS[key] : value;
}

module.exports = { DEFAULTS, seedConfigFromEnv, cfg };
