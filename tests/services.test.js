const { allowedForTier, needsConfirm, commandBase } = require('../src/services/rcon');
const { sha256 } = require('../src/util/crypto');
const { sanitizeRconCommand, parseDuration, maskIps } = require('../src/util/sanitize');
const { seedConfigFromEnv } = require('../src/config/store');
jest.mock('rcon-client', () => ({ Rcon: { connect: jest.fn() } }));
const { Rcon } = require('rcon-client');
jest.mock('minecraft-server-util', () => ({
  status: jest.fn(),
  queryFull: jest.fn()
}));

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

describe('Minecraft status embeds', () => {
  test('shows online details and the supported range without a website field', () => {
    const { statusEmbed } = require('../src/services/status');
    const db = { config: { get: () => undefined } };
    const server = { name: 'Survival', host: 'play.example.net', query_port: 25565, maintenance: 0 };
    const ping = {
      online: true,
      players: 1,
      max: 30,
      sample: ['Steve'],
      version: '1.21.1',
      motd: 'A Minecraft server',
      ping: 42
    };

    const result = statusEmbed(db, server, ping).toJSON();
    const fields = Object.fromEntries(result.fields.map((field) => [field.name, field.value]));

    expect(result.title).toContain('ONLINE');
    expect(fields.Players).toBe('1/30');
    expect(fields['Players online']).toBe('Steve');
    expect(fields.MOTD).toBe('A Minecraft server');
    expect(fields['Server address']).toBe('play.example.net:25565');
    expect(fields['Supported versions']).toBe('1.21–1.21.11 (latest)');
    expect(fields.Website).toBeUndefined();
    expect(result.timestamp).toBeDefined();
  });
});

describe('persistent Minecraft status panels', () => {
  test('edits the saved panel when /status is run again in the same channel', async () => {
    const { createStatusService } = require('../src/services/status');
    const message = { id: 'saved-message', edit: jest.fn().mockResolvedValue(undefined) };
    const channel = {
      id: 'status-channel',
      isTextBased: () => true,
      messages: { fetch: jest.fn().mockResolvedValue(message) },
      send: jest.fn()
    };
    const db = {
      config: { get: () => undefined },
      servers: {
        setStatusChannel: jest.fn(),
        setStatusMessage: jest.fn()
      }
    };
    const service = createStatusService({ env: {}, db, client: {} });
    const server = {
      id: 1,
      name: 'Survival',
      host: 'play.example.net',
      query_port: 25565,
      status_channel_id: channel.id,
      status_message_id: message.id
    };

    await service.publish(server, {
      online: true,
      players: 1,
      max: 30,
      sample: ['Alex'],
      version: '1.21.1',
      motd: 'Welcome',
      ping: 25
    }, channel);

    expect(message.edit).toHaveBeenCalledWith({ embeds: [expect.anything()] });
    expect(channel.send).not.toHaveBeenCalled();
    expect(db.servers.setStatusChannel).not.toHaveBeenCalled();
  });

  test('creates and records a replacement when the saved panel was deleted', async () => {
    const { createStatusService } = require('../src/services/status');
    const message = { id: 'replacement-message' };
    const channel = {
      id: 'status-channel',
      isTextBased: () => true,
      messages: { fetch: jest.fn().mockRejectedValue(new Error('Unknown message')) },
      send: jest.fn().mockResolvedValue(message)
    };
    const db = {
      config: { get: () => undefined },
      servers: {
        setStatusChannel: jest.fn(),
        setStatusMessage: jest.fn()
      }
    };
    const service = createStatusService({ env: {}, db, client: {} });
    const server = {
      id: 1,
      name: 'Survival',
      host: 'play.example.net',
      query_port: 25565,
      status_channel_id: channel.id,
      status_message_id: 'deleted-message'
    };

    await service.publish(server, {
      online: false,
      players: 0,
      max: 30,
      sample: [],
      version: 'unknown',
      motd: '',
      ping: 0
    }, channel);

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(db.servers.setStatusChannel).toHaveBeenCalledWith(server.id, channel.id);
    expect(db.servers.setStatusMessage).toHaveBeenCalledWith(server.id, message.id);
    expect(server.status_message_id).toBe(message.id);
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

describe('ticket queue management', () => {
  const { createTicketService } = require('../src/services/tickets');

  test('lists only the requested active or closed ticket state', () => {
    const queries = [];
    const db = {
      raw: {
        prepare(sql) {
          return {
            all(...args) {
              queries.push({ sql, args });
              return [];
            }
          };
        }
      }
    };
    const tickets = createTicketService({ db, client: {} });

    tickets.list('open', 'Staff recruitment');
    tickets.list('closed');

    expect(queries[0]).toMatchObject({
      sql: expect.stringContaining("WHERE status = ? AND category = ?"),
      args: ['open', 'Staff recruitment']
    });
    expect(queries[1]).toMatchObject({
      sql: expect.stringContaining('WHERE status = ? ORDER BY number DESC'),
      args: ['closed']
    });
    expect(() => tickets.list('deleted')).toThrow('TICKET_STATUS_INVALID');
  });

  test('removes a closed ticket channel and soft-deletes its queue record', async () => {
    const channel = { delete: jest.fn().mockResolvedValue(undefined) };
    let updateQuery;
    const db = {
      raw: {
        prepare(sql) {
          updateQuery = sql;
          return { run: jest.fn(() => ({ changes: 1 })) };
        }
      }
    };
    const guild = { channels: { fetch: jest.fn().mockResolvedValue(channel) } };
    const ticket = { id: 3, number: 17, channel_id: 'ticket-channel', status: 'closed' };
    const tickets = createTicketService({ db, client: {} });

    const removed = await tickets.remove(ticket, guild, 'staff-1');

    expect(channel.delete).toHaveBeenCalledWith('Ticket #17 removed by staff');
    expect(updateQuery).toContain("SET status = 'deleted'");
    expect(removed.status).toBe('deleted');
  });
});

describe('duplicate ticket prevention', () => {
  const { createTicketService } = require('../src/services/tickets');

  test('returns an existing open ticket for duplicate and rapid repeated submissions', async () => {
    let savedTicket;
    const createdChannel = { id: 'ticket-1', delete: jest.fn().mockResolvedValue(undefined) };
    const configuredRoles = new Map([
      ['developer_role_id', 'developer-role'],
      ['head_developer_role_id', 'head-developer-role']
    ]);
    const db = {
      config: { get: (key) => configuredRoles.get(key) },
      raw: {
        prepare(sql) {
          if (sql.includes('SELECT * FROM tickets WHERE submission_id')) {
            return { get: (id) => savedTicket?.submission_id === id ? savedTicket : undefined };
          }
          if (sql.includes('created_at >= datetime')) {
            return { get: (discordId, category) => savedTicket?.discord_id === discordId && savedTicket.category === category ? savedTicket : undefined };
          }
          if (sql.includes('COUNT(*)')) return { get: () => ({ c: savedTicket ? 1 : 0 }) };
          if (sql.includes('MAX(number)')) return { get: () => ({ n: savedTicket?.number || 0 }) };
          if (sql.includes('INSERT INTO tickets')) {
            return { run: (number, discordId, channelId, category, reason, mcName, submissionId) => {
              savedTicket = { number, discord_id: discordId, channel_id: channelId, category, reason, mc_name: mcName, submission_id: submissionId, status: 'open' };
            } };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        }
      }
    };
    const guild = {
      id: 'guild-1',
      channels: {
        create: jest.fn().mockResolvedValue(createdChannel),
        fetch: jest.fn().mockResolvedValue(createdChannel)
      }
    };
    const tickets = createTicketService({ db, client: {} });
    const request = {
      guild,
      user: { id: 'player-1' },
      category: 'Purchase / store',
      reason: 'Order help',
      mcName: 'Steve',
      submissionId: 'interaction-1'
    };

    const [first, concurrentRepeat] = await Promise.all([
      tickets.open(request),
      tickets.open({ ...request, submissionId: 'interaction-2' })
    ]);
    const repeatedInteraction = await tickets.open(request);
    const rapidRepeat = await tickets.open({ ...request, submissionId: 'interaction-3' });

    expect(first.duplicate).toBe(false);
    expect(concurrentRepeat).toMatchObject({ number: first.number, duplicate: true });
    expect(repeatedInteraction).toMatchObject({ number: first.number, duplicate: true });
    expect(rapidRepeat).toMatchObject({ number: first.number, duplicate: true });
    expect(guild.channels.create).toHaveBeenCalledTimes(1);
    const overwrites = guild.channels.create.mock.calls[0][0].permissionOverwrites;
    expect(overwrites.map((overwrite) => overwrite.id))
      .toEqual(expect.arrayContaining(['guild-1', 'player-1', 'developer-role', 'head-developer-role']));
    expect(overwrites.every((overwrite) => overwrite.type !== undefined)).toBe(true);
  });
});

describe('Minecraft player counts', () => {
  const { parsePlayerCounts } = require('../src/services/status');

  test.each([
    ['There are 1 out of maximum 30 players online.', 1, 30],
    ['There are 1 of a max of 30 players online: Steve', 1, 30],
    ['1/30 players online', 1, 30]
  ])('parses RCON player count response: %s', (response, players, max) => {
    expect(parsePlayerCounts(response)).toEqual({ players, max, sample: response.includes(':') ? ['Steve'] : [] });
  });

  test('rejects malformed and impossible player counts', () => {
    expect(parsePlayerCounts('RCON command complete')).toBeNull();
    expect(parsePlayerCounts('There are 31 out of maximum 30 players online.')).toBeNull();
  });

  test('uses RCON counts when the Minecraft status response reports 0/0', async () => {
    const minecraftUtil = require('minecraft-server-util');
    const rcon = require('../src/services/rcon');
    minecraftUtil.status.mockReset().mockResolvedValue({
      players: { online: 0, max: 0, sample: [] },
      version: { name: 'Paper' },
      motd: { clean: 'Server' },
      roundTripLatency: 5
    });
    const rconSpy = jest.spyOn(rcon, 'sendRcon').mockResolvedValue({
      result: 'There are 1 out of maximum 30 players online.'
    });

    try {
      const { pingServer } = require('../src/services/status');
      const result = await pingServer(
        { id: 1, name: 'Survival', host: 'localhost', query_port: 25565 },
        { env: {}, db: {} }
      );

      expect(result).toMatchObject({ online: true, players: 1, max: 30 });
      expect(rconSpy).toHaveBeenCalledWith({}, {}, expect.objectContaining({ name: 'Survival' }), 'list');
    } finally {
      rconSpy.mockRestore();
    }
  });
});

describe('separate RCON endpoint', () => {
  test('connects to the configured RCON host rather than the game/query host', async () => {
    const { sendRcon, disconnectAll } = require('../src/services/rcon');
    const client = {
      send: jest.fn().mockResolvedValue('There are 1 out of maximum 30 players online.'),
      on: jest.fn(),
      end: jest.fn(),
      authed: true
    };
    Rcon.connect.mockReset().mockResolvedValue(client);
    const server = {
      id: 'rcon-host-test',
      host: 'game.example.test',
      rcon_host: 'remote-rcon.example.test',
      rcon_port: 11150,
      name: 'Test server'
    };

    try {
      await sendRcon({}, { config: { get: () => undefined } }, server, 'list');
      expect(Rcon.connect).toHaveBeenCalledWith(expect.objectContaining({
        host: 'remote-rcon.example.test',
        port: 11150
      }));
    } finally {
      disconnectAll();
    }
  });
});

describe('advanced appeals voting', () => {
  const { createAppealsService } = require('../src/services/appeals');

  test('requires the configured number of distinct staff votes and records decision reasons', async () => {
    const appeal = {
      id: 4,
      case_id: 'C-20261006-ABC12345',
      discord_id: 'player-1',
      channel_id: 'appeal-channel',
      explanation: 'I believe this ban was applied to the wrong player.',
      status: 'open',
      accept_votes: '[]',
      deny_votes: '[]'
    };
    const db = {
      config: { get: (key) => key === 'appeal_min_votes' ? 2 : undefined },
      raw: {
        prepare(sql) {
          if (sql.startsWith('SELECT * FROM appeals WHERE id = ?')) return { get: () => ({ ...appeal }) };
          if (sql.startsWith('UPDATE appeals') && sql.includes('accept_votes = ?')) {
            return { run: (acceptVotes, denyVotes, decisionReason, decisionAction, status) => {
              appeal.accept_votes = acceptVotes;
              appeal.deny_votes = denyVotes;
              appeal.decision_reason = decisionReason;
              appeal.decision_action = decisionAction;
              appeal.status = status;
              return { changes: 1 };
            } };
          }
          if (sql.startsWith('UPDATE appeals') && sql.includes("status = 'accepted'")) {
            return { run: () => { appeal.status = 'accepted'; return { changes: 1 }; } };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        transaction: (fn) => () => fn()
      }
    };
    const ctx = {
      db,
      moderation: { liftByCase: jest.fn().mockResolvedValue({ case_id: appeal.case_id }) },
      staffLog: { add: jest.fn() }
    };
    const appeals = createAppealsService(ctx);
    const guild = {};

    const firstVote = await appeals.vote(appeal.id, 'staff-1', true, 'Evidence supports reviewing this ban.', guild);
    const finalVote = await appeals.vote(appeal.id, 'staff-2', true, 'The evidence confirms this was mistaken.', guild);

    expect(firstVote).toMatchObject({ status: 'pending', acceptCount: 1, requiredVotes: 2 });
    expect(finalVote).toMatchObject({ status: 'accepted', acceptCount: 2, denyCount: 0 });
    expect(ctx.moderation.liftByCase).toHaveBeenCalledWith(guild, appeal.case_id);
    expect(appeal.status).toBe('accepted');
    expect(ctx.staffLog.add).toHaveBeenCalledWith(expect.objectContaining({
      action: 'appeal_vote_accept',
      actorId: 'staff-2'
    }));
  });

  test('prevents the same staff member from voting twice to satisfy the threshold', async () => {
    const appeal = {
      id: 5,
      case_id: 'C-20261006-DEF12345',
      discord_id: 'player-2',
      explanation: 'I believe this mute was applied by mistake.',
      status: 'open',
      accept_votes: '[]',
      deny_votes: '[]'
    };
    const db = {
      config: { get: (key) => key === 'appeal_min_votes' ? 2 : undefined },
      raw: {
        prepare(sql) {
          if (sql.startsWith('SELECT * FROM appeals WHERE id = ?')) return { get: () => ({ ...appeal }) };
          if (sql.startsWith('UPDATE appeals') && sql.includes('accept_votes = ?')) {
            return { run: (acceptVotes, denyVotes, decisionReason, decisionAction, status) => {
              appeal.accept_votes = acceptVotes;
              appeal.deny_votes = denyVotes;
              appeal.decision_reason = decisionReason;
              appeal.decision_action = decisionAction;
              appeal.status = status;
              return { changes: 1 };
            } };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        transaction: (fn) => () => fn()
      }
    };
    const ctx = {
      db,
      moderation: { liftByCase: jest.fn() },
      staffLog: { add: jest.fn() }
    };
    const appeals = createAppealsService(ctx);

    await appeals.vote(appeal.id, 'staff-1', false, 'The punishment is supported by the case evidence.', {});
    const repeatedVote = await appeals.vote(appeal.id, 'staff-1', false, 'After review I still support the decision.', {});

    expect(repeatedVote).toMatchObject({ status: 'pending', denyCount: 1, requiredVotes: 2 });
    expect(ctx.moderation.liftByCase).not.toHaveBeenCalled();
  });

  test('reopens an appeal when lifting the punishment fails so staff can retry', async () => {
    const appeal = {
      id: 6,
      case_id: 'C-20261006-GHI12345',
      discord_id: 'player-3',
      explanation: 'The ban was issued in error.',
      status: 'open',
      accept_votes: '[]',
      deny_votes: '[]'
    };
    const db = {
      config: { get: (key) => key === 'appeal_min_votes' ? 1 : undefined },
      raw: {
        prepare(sql) {
          if (sql.startsWith('SELECT * FROM appeals WHERE id = ?')) return { get: () => ({ ...appeal }) };
          if (sql.startsWith('UPDATE appeals') && sql.includes('accept_votes = ?')) {
            return { run: (acceptVotes, denyVotes, decisionReason, decisionAction, status) => {
              appeal.accept_votes = acceptVotes;
              appeal.deny_votes = denyVotes;
              appeal.decision_reason = decisionReason;
              appeal.decision_action = decisionAction;
              appeal.status = status;
              return { changes: 1 };
            } };
          }
          if (sql.startsWith('UPDATE appeals') && sql.includes("status = 'open'")) {
            return { run: () => { appeal.status = 'open'; return { changes: 1 }; } };
          }
          if (sql.startsWith('UPDATE appeals') && sql.includes("status = 'accepted'")) {
            return { run: () => { appeal.status = 'accepted'; return { changes: 1 }; } };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        transaction: (fn) => () => fn()
      }
    };
    const ctx = {
      db,
      moderation: {
        liftByCase: jest.fn()
          .mockRejectedValueOnce(new Error('RCON unavailable'))
          .mockResolvedValue({ case_id: appeal.case_id })
      },
      staffLog: { add: jest.fn() }
    };
    const appeals = createAppealsService(ctx);
    const reason = 'The case evidence confirms the appeal.';

    await expect(appeals.vote(appeal.id, 'staff-1', true, reason, {}))
      .rejects.toThrow('RCON unavailable');
    expect(appeal.status).toBe('open');

    await expect(appeals.vote(appeal.id, 'staff-1', true, reason, {}))
      .resolves.toMatchObject({ status: 'accepted', acceptCount: 1 });
    expect(appeal.status).toBe('accepted');
  });

  test('requires distinct staff votes for the same temporary-ban reduction', async () => {
    const appeal = {
      id: 7,
      case_id: 'C-20261007-JKL12345',
      discord_id: 'player-4',
      explanation: 'I have served most of the ban and request a shorter duration.',
      status: 'open',
      accept_votes: '[]',
      deny_votes: '[]',
      decision_action: null,
      decision_duration: null
    };
    const db = {
      config: { get: (key) => key === 'appeal_min_votes' ? 2 : undefined },
      raw: {
        prepare(sql) {
          if (sql.startsWith('SELECT * FROM appeals WHERE id = ?')) return { get: () => ({ ...appeal }) };
          if (sql.startsWith('UPDATE appeals') && sql.includes("decision_action = 'reduce'")) {
            return { run: (acceptVotes, denyVotes, reason, duration, status) => {
              appeal.accept_votes = acceptVotes;
              appeal.deny_votes = denyVotes;
              appeal.decision_reason = reason;
              appeal.decision_action = 'reduce';
              appeal.decision_duration = duration;
              appeal.status = status;
              return { changes: 1 };
            } };
          }
          if (sql.startsWith('UPDATE appeals') && sql.includes("status = 'accepted'")) {
            return { run: () => { appeal.status = 'accepted'; return { changes: 1 }; } };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        transaction: (fn) => () => fn()
      }
    };
    const ctx = {
      db,
      moderation: { reduceTemporaryBan: jest.fn().mockResolvedValue({ case_id: appeal.case_id }) },
      staffLog: { add: jest.fn() }
    };
    const appeals = createAppealsService(ctx);
    const reason = 'Evidence supports reducing the remaining punishment.';

    const first = await appeals.voteReduction(appeal.id, 'staff-1', '2d', reason);
    const final = await appeals.voteReduction(appeal.id, 'staff-2', '2d', reason);

    expect(first).toMatchObject({ status: 'pending', acceptCount: 1, requiredVotes: 2 });
    expect(final).toMatchObject({ status: 'reduced', acceptCount: 2, duration: '2d' });
    expect(ctx.moderation.reduceTemporaryBan).toHaveBeenCalledWith(appeal.case_id, '2d', reason);
    expect(appeal.status).toBe('accepted');
    await expect(appeals.voteReduction(appeal.id, 'staff-3', '1d', reason)).rejects.toThrow('CLOSED');
  });
});

describe('Paper plugin webhook binding', () => {
  const { createHttpServer, createPluginWebhookServer } = require('../src/http/server');
  const { sign } = require('../src/services/pluginClient');

  test('accepts signed in-game link codes and rejects unsigned payloads', async () => {
    const env = { BOT_HTTP_PORT: 0, HMAC_SHARED_SECRET: 'test-shared-secret-for-plugin' };
    const serverRecord = { id: 'server-1', name: 'survival' };
    const storeCode = jest.fn();
    const link = jest.fn();
    const unlinkMinecraft = jest.fn();
    const ctx = {
      env,
      db: {
        config: { get: () => 18 },
        servers: {
          getByName: () => serverRecord,
          all: () => [serverRecord]
        }
      },
      links: { storeCode, link, unlinkMinecraft }
    };
    const httpServer = createHttpServer(ctx);
    await new Promise((resolve) => httpServer.once('listening', resolve));

    try {
      const endpoint = `http://127.0.0.1:${httpServer.address().port}/plugin/event`;
      const body = JSON.stringify({
        type: 'link_code',
        server: 'survival',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
        username: 'Player',
        code: 'ABC234'
      });
      const timestamp = String(Date.now());
      const accepted = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Timestamp': timestamp,
          'X-Signature': sign(env.HMAC_SHARED_SECRET, timestamp, body)
        },
        body
      });

      expect(accepted.status).toBe(204);
      expect(storeCode).toHaveBeenCalledWith('ABC234', '123e4567-e89b-12d3-a456-426614174000', 'Player');

      const linkedBody = JSON.stringify({
        type: 'discordsrv_linked',
        server: 'survival',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
        username: 'Player',
        discordId: '123456789012345678'
      });
      const linkedTimestamp = String(Date.now());
      const linkedResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Timestamp': linkedTimestamp,
          'X-Signature': sign(env.HMAC_SHARED_SECRET, linkedTimestamp, linkedBody)
        },
        body: linkedBody
      });
      expect(linkedResponse.status).toBe(204);
      expect(link).toHaveBeenCalledWith({
        discordId: '123456789012345678',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
        username: 'Player'
      });

      const unlinkedBody = JSON.stringify({
        type: 'discordsrv_unlinked',
        server: 'survival',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
        discordId: '123456789012345678'
      });
      const unlinkedTimestamp = String(Date.now());
      const unlinkedResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Timestamp': unlinkedTimestamp,
          'X-Signature': sign(env.HMAC_SHARED_SECRET, unlinkedTimestamp, unlinkedBody)
        },
        body: unlinkedBody
      });
      expect(unlinkedResponse.status).toBe(204);
      expect(unlinkMinecraft).toHaveBeenCalledWith({
        discordId: '123456789012345678',
        uuid: '123e4567-e89b-12d3-a456-426614174000'
      });

      const rejected = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      expect(rejected.status).toBe(401);
      expect(storeCode).toHaveBeenCalledTimes(1);
    } finally {
      await new Promise((resolve, reject) => httpServer.close((err) => err ? reject(err) : resolve()));
    }
  });

  test('dedicated tunnel listener exposes only the signed plugin event endpoint', async () => {
    const env = { PLUGIN_WEBHOOK_PORT: 0, HMAC_SHARED_SECRET: 'test-shared-secret-for-plugin' };
    const storeCode = jest.fn();
    const serverRecord = { id: 1, name: 'survival' };
    const ctx = {
      env,
      db: {
        config: { get: () => 18 },
        servers: { getByName: () => serverRecord, all: () => [serverRecord] }
      },
      links: { storeCode }
    };
    const server = createPluginWebhookServer(ctx);
    await new Promise((resolve) => server.once('listening', resolve));

    try {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const health = await fetch(`${baseUrl}/health`);
      expect(health.status).toBe(404);

      const body = JSON.stringify({
        type: 'link_code',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
        username: 'TunnelPlayer',
        code: 'XYZ789'
      });
      const timestamp = String(Date.now());
      const accepted = await fetch(`${baseUrl}/plugin/event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Timestamp': timestamp,
          'X-Signature': sign(env.HMAC_SHARED_SECRET, timestamp, body)
        },
        body
      });

      expect(accepted.status).toBe(204);
      expect(storeCode).toHaveBeenCalledWith('XYZ789', '123e4567-e89b-12d3-a456-426614174000', 'TunnelPlayer');
    } finally {
      await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
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

  test('unlinks only the specified Minecraft account from the matching Discord account', () => {
    const links = createLinkService(db);
    links.link({ discordId: 'discord-9', uuid: '00000000-0000-0000-0000-000000000009', username: 'Linked' });
    links.link({ discordId: 'discord-10', uuid: '00000000-0000-0000-0000-000000000010', username: 'Other' });

    links.unlinkMinecraft({ discordId: 'discord-9', uuid: '00000000000000000000000000000009' });

    expect(links.getByUuid('00000000-0000-0000-0000-000000000009')).toBeUndefined();
    expect(links.getByUuid('00000000-0000-0000-0000-000000000010')).toMatchObject({ discord_id: 'discord-10' });
    expect(() => links.unlinkMinecraft({
    discordId: 'discord-9',
    uuid: '00000000-0000-0000-0000-000000000010'
    })).not.toThrow();
    expect(links.getByUuid('00000000-0000-0000-0000-000000000010')).toMatchObject({ discord_id: 'discord-10' });
  });

  test('refreshing a verified link updates the username without resetting its link date', () => {
    const links = createLinkService(db);
    const uuid = '00000000-0000-0000-0000-000000000011';
    links.link({ discordId: 'discord-11', uuid, username: 'Before' });
    db.raw.prepare("UPDATE linked_accounts SET linked_at = '2000-01-01 00:00:00' WHERE minecraft_uuid = ?").run(uuid);

    links.link({ discordId: 'discord-11', uuid, username: 'After' });

    expect(links.getByUuid(uuid)).toMatchObject({
      discord_id: 'discord-11',
      username: 'After',
      linked_at: '2000-01-01 00:00:00'
    });
  });

  test('completes linking and consumes the code atomically', () => {
    const links = createLinkService(db);
    const code = links.createCode('00000000-0000-0000-0000-000000000004', 'Taylor');

    expect(links.completeLink(code.toLowerCase(), 'discord-4')).toMatchObject({
      minecraft_uuid: '00000000-0000-0000-0000-000000000004',
      username: 'Taylor'
    });
    expect(links.getByDiscord('discord-4')).toHaveLength(1);
    expect(links.completeLink(code, 'discord-4')).toBeNull();
  });

  test('does not burn a valid code when account linking is rejected', () => {
    const links = createLinkService(db);
    links.link({ discordId: 'discord-5', uuid: '00000000-0000-0000-0000-000000000005', username: 'Existing' });
    const code = links.createCode('00000000-0000-0000-0000-000000000006', 'Second');

    expect(() => links.completeLink(code, 'discord-5')).toThrow('LINK_LIMIT');
    expect(links.consume(code)).toMatchObject({ username: 'Second' });
  });

  test('does not consume a code when the Minecraft account belongs to another Discord user', () => {
    const links = createLinkService(db);
    links.link({ discordId: 'discord-7', uuid: '00000000-0000-0000-0000-000000000007', username: 'Taken' });
    const code = links.createCode('00000000-0000-0000-0000-000000000007', 'Taken');

    expect(() => links.completeLink(code, 'discord-8')).toThrow('UUID_TAKEN');
    expect(links.consume(code)).toMatchObject({ username: 'Taken' });
  });
});

describe('backup configuration errors', () => {
  test('fails before RCON when the bot has no accessible world path', async () => {
    const { createBackupService } = require('../src/services/backups');
    const backups = createBackupService({
      db: {},
      env: { MC_WORLD_PATH: '', MC_BACKUP_PATH: './backups' }
    });

    await expect(backups.run({ name: 'survival' })).rejects.toMatchObject({
      code: 'BACKUP_WORLD_PATH_MISSING'
    });
  });

  describe('staff oversight reports', () => {
    const Database = require('better-sqlite3');
    const { createStaffLog } = require('../src/services/staffLog');
    let raw;
    let staffLog;

    beforeAll(() => {
      raw = new Database(':memory:');
      raw.exec(`CREATE TABLE staff_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id TEXT NOT NULL,
        actor_discord_id TEXT NOT NULL,
        target_discord_id TEXT,
        target_uuid TEXT,
        target_name TEXT,
        action TEXT NOT NULL,
        reason TEXT,
        result TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      staffLog = createStaffLog({ raw });
    });

    afterAll(() => raw.close());

    test('aggregates staff actions and moderation totals and filters audit rows', () => {
      const recent = new Date(Date.now() - 60_000).toISOString().slice(0, 19).replace('T', ' ');
      const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
      const add = (caseId, actorId, action, createdAt, reason = action) => {
        staffLog.add({ caseId, actorId, action, reason, result: 'ok' });
        raw.prepare('UPDATE staff_log SET created_at = ? WHERE case_id = ?').run(createdAt, caseId);
      };
      add('CASE-1', 'staff-1', 'warn', recent, 'Spam');
      add('CASE-2', 'staff-1', 'warn', recent, 'Spam again');
      add('CASE-3', 'staff-2', 'ban', recent, 'Griefing');
      add('CASE-4', 'staff-2', 'ticket_close', recent);
      add('CASE-5', 'staff-1', 'kick', old);

      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
      expect(staffLog.activity({ since, actorId: 'staff-1' })).toEqual([
        expect.objectContaining({ actor_discord_id: 'staff-1', action: 'warn', count: 2 })
      ]);
      expect(staffLog.moderationSummary({ since })).toMatchObject({
        total: 3,
        actions: [
          { action: 'warn', count: 2 },
          { action: 'ban', count: 1 }
        ]
      });
      expect(staffLog.auditSearch({ since, actorId: 'staff-1', action: 'warn', limit: 15 }))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ case_id: 'CASE-1' }),
          expect.objectContaining({ case_id: 'CASE-2' })
        ]));
      expect(staffLog.auditSearch({ since, actorId: 'staff-1', action: 'warn', limit: 15 })).toHaveLength(2);
    });
  });

  describe('moderation target history', () => {
    const Database = require('better-sqlite3');
    const { createModerationService } = require('../src/services/moderation');
    let db;
    let raw;
    let moderation;

    beforeAll(() => {
      raw = new Database(':memory:');
      raw.exec(`CREATE TABLE punishments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id TEXT NOT NULL,
        type TEXT NOT NULL,
        target_discord_id TEXT,
        target_uuid TEXT,
        target_name TEXT,
        duration_ms INTEGER,
        expires_at INTEGER,
        active INTEGER NOT NULL DEFAULT 1,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE staff_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id TEXT NOT NULL,
        actor_discord_id TEXT NOT NULL
      );`);
      db = {
        raw,
        servers: { all: () => [] }
      };
      moderation = createModerationService({ db, env: {}, staffLog: {} });
    });

    afterAll(() => raw.close());

    test('queries punishment history by linked identifiers and includes case actor', () => {
      raw.prepare(`INSERT INTO punishments (case_id, type, target_discord_id, target_uuid, target_name, active, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run('CASE-1', 'ban', 'discord-1', 'uuid-1', 'Steve', 0, 'Old ban');
      raw.prepare('INSERT INTO staff_log (case_id, actor_discord_id) VALUES (?, ?)').run('CASE-1', 'staff-1');
      raw.prepare(`INSERT INTO punishments (case_id, type, target_discord_id, target_uuid, target_name, active, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run('CASE-2', 'warn', 'discord-2', 'uuid-2', 'Other', 1, 'Unrelated');

      expect(moderation.historyForTarget({
        discordId: 'discord-1',
        uuid: 'uuid-1',
        username: 'steve'
      })).toMatchObject([{
        case_id: 'CASE-1',
        target_name: 'Steve',
        actor_discord_id: 'staff-1',
        active: 0
      }]);
    });

    test('refuses an audit lookup with no target identifiers', () => {
      expect(() => moderation.historyForTarget({})).toThrow('TARGET_REQUIRED');
    });

    test('finds a case-insensitive active punishment but skips expired rows', () => {
      raw.prepare(`INSERT INTO punishments (case_id, type, target_name, expires_at, active, reason)
        VALUES (?, ?, ?, ?, 1, ?), (?, ?, ?, ?, 1, ?)`)
        .run(
          'CASE-3', 'tempban', 'Steve', Date.now() - 1000, 'Expired',
          'CASE-4', 'tempban', 'Steve', Date.now() + 60000, 'Active'
        );

      expect(moderation.getActiveByPlayer('steve')).toMatchObject({
        case_id: 'CASE-4',
        reason: 'Active'
      });
    });
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

describe('AdvancedBan command confirmation', () => {
  const { assertAdvancedBanResponse, parseAdvancedBanDuration } = require('../src/services/moderation');

  test('accepts the success messages from the supplied AdvancedBan templates', () => {
    expect(() => assertAdvancedBanResponse('Alex was successfully unbanned!', 'unban')).not.toThrow();
    expect(() => assertAdvancedBanResponse('Alex got banned by Console', 'tempban')).not.toThrow();
  });

  test('does not treat AdvancedBan duration, duplicate-ban, or permission errors as success', () => {
    for (const message of [
      'You are not able to ban more than 600sec',
      'Alex has already been banned!',
      "You don't have perms for that!"
    ]) {
      expect(() => assertAdvancedBanResponse(message, 'tempban')).toThrow('ADVANCEDBAN_COMMAND_FAILED');
    }
    expect(() => assertAdvancedBanResponse('', 'unban')).toThrow('ADVANCEDBAN_UNCONFIRMED');
  });

  test('accepts AdvancedBan month durations and rejects malformed or overflowing durations', () => {
    expect(parseAdvancedBanDuration('1mo')).toBe(30 * 86400000);
    expect(parseAdvancedBanDuration('2d')).toBe(2 * 86400000);
    expect(parseAdvancedBanDuration('1 month')).toBeNull();
    expect(parseAdvancedBanDuration('999999999mo')).toBeNull();
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
