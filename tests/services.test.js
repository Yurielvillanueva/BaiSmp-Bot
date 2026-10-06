const { allowedForTier, needsConfirm, commandBase } = require('../src/services/rcon');
const { sha256 } = require('../src/util/crypto');
const { sanitizeRconCommand, parseDuration, maskIps } = require('../src/util/sanitize');
const { seedConfigFromEnv } = require('../src/config/store');

describe('environment config seeding', () => {
  test('fills blank role IDs without replacing configured values', () => {
    const previousDeveloperRole = process.env.DEVELOPER_ROLE_ID;
    const previousAdminRole = process.env.ADMIN_ROLE_ID;
    process.env.DEVELOPER_ROLE_ID = 'developer-from-env';
    process.env.ADMIN_ROLE_ID = 'admin-from-env';
    const values = new Map([
      ['developer_role_id', ''],
      ['admin_role_id', 'admin-from-database'],
      ['rcon_allowlists', { helper: ['say'] }]
    ]);
    const db = {
      config: {
        get: (key) => values.get(key),
        set: (key, value) => values.set(key, value)
      }
    };

    try {
      seedConfigFromEnv(db, {});
      expect(values.get('developer_role_id')).toBe('developer-from-env');
      expect(values.get('admin_role_id')).toBe('admin-from-database');
      expect(values.get('rcon_allowlists').helper).toEqual(['say']);
      expect(values.get('rcon_allowlists').developer).toContain('list');
      expect(values.get('rcon_allowlists')['head-developer']).toContain('list');
    } finally {
      if (previousDeveloperRole === undefined) delete process.env.DEVELOPER_ROLE_ID;
      else process.env.DEVELOPER_ROLE_ID = previousDeveloperRole;
      if (previousAdminRole === undefined) delete process.env.ADMIN_ROLE_ID;
      else process.env.ADMIN_ROLE_ID = previousAdminRole;
    }
  });
});

function dbWith(allow) {
  return {
    config: {
      get(key) {
        if (key === 'rcon_allowlists') return allow;
        if (key === 'rcon_blocked') return ['stop', 'op', 'deop'];
        if (key === 'rcon_confirm') return ['reload'];
        return undefined;
      }
    }
  };
}

describe('RCON allowlist', () => {
  const db = dbWith({
    helper: ['say', 'list'],
    mod: ['say', 'list', 'kick'],
    admin: ['say', 'kick', 'ban', 'whitelist'],
    owner: ['*']
  });

  test('blocks stop/op/deop', () => {
    expect(allowedForTier(db, 'owner', 'stop').ok).toBe(false);
    expect(allowedForTier(db, 'admin', 'op Steve').reason).toBe('blocked');
    expect(allowedForTier(db, 'mod', 'deop Steve').ok).toBe(false);
  });

  test('helper cannot kick', () => {
    expect(allowedForTier(db, 'helper', 'kick Steve').ok).toBe(false);
    expect(allowedForTier(db, 'mod', 'kick Steve').ok).toBe(true);
  });

  test('owner wildcard still blocked from stop', () => {
    expect(allowedForTier(db, 'owner', 'list').ok).toBe(true);
    expect(allowedForTier(db, 'owner', 'stop').ok).toBe(false);
  });

  test('confirm list', () => {
    expect(needsConfirm(db, 'reload')).toBe(true);
    expect(needsConfirm(db, 'list')).toBe(false);
  });

  test('sanitize rejects injection', () => {
    expect(() => sanitizeRconCommand('say hi\nstop')).toThrow();
    expect(sanitizeRconCommand('/list')).toBe('list');
    expect(commandBase('Whitelist add x')).toBe('whitelist');
  });
});

describe('ticket transcripts and logs', () => {
  const { createTicketService } = require('../src/services/tickets');
  const fs = require('fs');
  const path = require('path');

  test('paginates the full conversation, escapes content, and delivers the transcript', async () => {
    const number = Date.now();
    const file = path.resolve(`./data/transcripts/ticket-${number}.html`);
    const messages = Array.from({ length: 101 }, (_, index) => ({
      id: String(101 - index),
      createdTimestamp: 1700000000000 + index,
      author: { tag: `Player${index}` },
      content: index === 0 ? '<script>alert(1)</script>' : `Message ${index}`,
      attachments: new Map(),
      embeds: []
    }));
    const collection = (items) => {
      const values = new Map(items.map((message) => [message.id, message]));
      return {
        size: values.size,
        values: () => values.values(),
        last: () => [...values.values()].at(-1)
      };
    };
    const batches = [collection(messages.slice(0, 100)), collection(messages.slice(100))];
    const ticketChannel = {
      id: 'ticket-channel',
      messages: { fetch: jest.fn(async () => batches.shift()) },
      delete: jest.fn().mockResolvedValue(undefined)
    };
    const logChannel = {
      isTextBased: () => true,
      send: jest.fn().mockResolvedValue(undefined)
    };
    const db = {
      config: { get: (key) => key === 'ticket_log_channel_id' ? 'ticket-log-channel' : undefined },
      raw: {
        prepare: () => ({ run: () => ({ changes: 1 }) })
      }
    };
    const client = {
      channels: {
        fetch: jest.fn(async (id) => id === 'ticket-log-channel' ? logChannel : ticketChannel)
      },
      users: {
        fetch: jest.fn(async () => ({ send: jest.fn().mockResolvedValue(undefined) }))
      }
    };
    const guild = { channels: { fetch: jest.fn().mockResolvedValue(ticketChannel) } };
    const ticket = {
      id: 3,
      number,
      discord_id: 'user-1',
      channel_id: 'ticket-channel',
      category: 'Purchase / store',
      reason: 'order details',
      mc_name: 'Steve',
      claimed_by: 'staff-1',
      created_at: '2026-10-06'
    };

    try {
      const result = await createTicketService({ db, client }).close(ticket, guild, 'staff-2');
      const transcript = fs.readFileSync(file, 'utf8');

      expect(result.logDelivered).toBe(true);
      expect(ticketChannel.messages.fetch).toHaveBeenCalledTimes(2);
      expect(transcript).toContain('Message 100');
      expect(transcript).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(transcript).not.toContain('<script>alert(1)</script>');
      expect(logChannel.send).toHaveBeenCalledWith(expect.objectContaining({
        files: [file]
      }));
    } finally {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });
});

describe('linking codes', () => {
  const { createLinkService } = require('../src/services/linking');
  const { migrate, closeDb } = require('../src/db/migrate');
  const { createDb } = require('../src/db');
  const fs = require('fs');
  const path = './data/test-link.sqlite';

  let db;
  beforeAll(() => {
    fs.mkdirSync('./data', { recursive: true });
    try { fs.unlinkSync(path); } catch { /* ignore */ }
    migrate(path);
    db = createDb(path);
    db.config.set('max_links_per_discord', 1, 'test');
    db.config.set('link_code_ttl_minutes', 10, 'test');
  });
  afterAll(() => {
    closeDb();
  });

  test('hash and one-time consume', () => {
    const links = createLinkService(db);
    const code = links.createCode('00000000-0000-0000-0000-000000000001', 'Steve');
    expect(code).toHaveLength(6);
    const row = db.raw.prepare('SELECT * FROM link_codes').get();
    expect(row.code_hash).toBe(sha256(code.toUpperCase()));
    expect(links.consume(code).username).toBe('Steve');
    expect(links.consume(code)).toBeNull();
  });

  test('one minecraft per discord limit', () => {
    const links = createLinkService(db);
    links.link({ discordId: '1', uuid: '00000000-0000-0000-0000-000000000002', username: 'Alex' });
    expect(() => links.link({ discordId: '1', uuid: '00000000-0000-0000-0000-000000000003', username: 'Bob' })).toThrow('LINK_LIMIT');
  });
});

describe('whitelist floodgate', () => {
  const { floodgateName } = require('../src/util/sanitize');
  test('keeps prefix names', () => {
    expect(floodgateName('.BedrockUser', '.')).toBe('.BedrockUser');
    expect(floodgateName('Steve', '.')).toBe('Steve');
  });
});

describe('moderation durations', () => {
  test('parses 7d and 12h', () => {
    expect(parseDuration('7d')).toBe(7 * 86400000);
    expect(parseDuration('12h')).toBe(12 * 3600000);
    expect(parseDuration('nope')).toBeNull();
  });
});

describe('ip masking', () => {
  test('never leaves raw ipv4 in logs', () => {
    expect(maskIps('Player from 192.168.1.20 joined')).toContain('[ip]');
    expect(maskIps('Player from 192.168.1.20 joined')).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});

describe('stats flatten', () => {
  const { flattenStats } = require('../src/services/stats');
  const sample = require('./fixtures/sample-stats.json');
  test('reads playtime deaths kills mined', () => {
    const s = flattenStats(sample);
    expect(s.playtimeMin).toBe(60);
    expect(s.deaths).toBe(3);
    expect(s.mobKills).toBe(40);
    expect(s.mined).toBe(120);
  });
});
