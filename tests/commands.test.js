const { loadCommands } = require('../src/commands');
const { attachBot } = require('../src/bot');
jest.mock('../src/services/rcon', () => ({ sendRcon: jest.fn() }));
const { sendRcon } = require('../src/services/rcon');
jest.mock('minecraft-server-util', () => ({
  status: jest.fn(),
  queryFull: jest.fn()
}));
const minecraftServerUtil = require('minecraft-server-util');

describe('status command', () => {
  beforeEach(() => minecraftServerUtil.status.mockReset());

  test('publishes a live configured status panel and confirms automatic refresh', async () => {
    minecraftServerUtil.status.mockResolvedValue({
      players: { online: 1, max: 30, sample: [{ name: 'Alex' }] },
      version: { name: 'Paper 1.21.1' },
      motd: { clean: 'Welcome to Survival' },
      roundTripLatency: 32
    });
    const command = loadCommands().find((item) => item.data.name === 'status');
    const interaction = {
      options: { getString: () => null, getInteger: () => null },
      channel: { id: 'status-channel' },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };
    const server = { id: 1, name: 'Survival', host: 'play.example.net', query_port: 25565, maintenance: 0 };
    const publish = jest.fn().mockResolvedValue(undefined);
    const ctx = {
      db: {
        servers: { all: () => [server] },
        config: { get: () => undefined }
      },
      status: { publish },
      env: { STATUS_INTERVAL_MS: 30000 }
    };

    await command.execute(interaction, ctx);

    expect(publish).toHaveBeenCalledWith(server, expect.objectContaining({
      online: true,
      players: 1,
      max: 30,
      sample: ['Alex']
    }), interaction.channel);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Live status panel updated in this channel. It refreshes automatically every 30 seconds.'
    });
  });

  test('offers only address and port options to prevent a server-name conflict', () => {
    const command = loadCommands().find((item) => item.data.name === 'status');
    const optionNames = command.data.toJSON().options.map((option) => option.name);

    expect(optionNames).toEqual(['address', 'port']);
  });

  test('creates live panels for each configured server and reports omitted servers', async () => {
    minecraftServerUtil.status.mockResolvedValue({
      players: { online: 2, max: 30, sample: [{ name: 'Alex' }, { name: 'Steve' }] },
      version: { name: 'Paper 1.21.1' },
      motd: { clean: 'Welcome to Survival' },
      roundTripLatency: 32
    });
    const command = loadCommands().find((item) => item.data.name === 'status');
    const interaction = {
      options: { getString: () => null, getInteger: () => null },
      channel: { id: 'status-channel' },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };
    const servers = Array.from({ length: 11 }, (_, id) => ({
      id,
      name: `Server ${id}`,
      host: 'play.example.net',
      query_port: 25565
    }));
    const publish = jest.fn().mockResolvedValue(undefined);
    const ctx = {
      db: {
        servers: { all: () => servers },
        config: { get: () => undefined }
      },
      status: { publish },
      env: { STATUS_INTERVAL_MS: 15000 }
    };

    await command.execute(interaction, ctx);

    expect(publish).toHaveBeenCalledTimes(10);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Live status panels updated in this channel. It refreshes automatically every 15 seconds. Showing 10 of 11 configured servers.'
    });
  });

  test('checks a supplied IP address and port without a configured server entry', async () => {
    minecraftServerUtil.status.mockResolvedValue({
      players: { online: 1, max: 20, sample: [{ name: 'Alex' }] },
      version: { name: 'Paper 1.21.1' },
      motd: { clean: 'Direct connection test' },
      roundTripLatency: 25
    });
    const command = loadCommands().find((item) => item.data.name === 'status');
    const interaction = {
      options: {
        getString: (name) => (name === 'address' ? '192.0.2.10' : null),
        getInteger: (name) => (name === 'port' ? 25570 : null)
      },
      reply: jest.fn().mockResolvedValue(undefined)
    };
    const ctx = { db: { config: { get: () => undefined } } };

    await command.execute(interaction, ctx);

    expect(minecraftServerUtil.status).toHaveBeenCalledWith('192.0.2.10', 25570, { timeout: 4000 });
    const fields = Object.fromEntries(interaction.reply.mock.calls[0][0].embeds[0].toJSON().fields
      .map((field) => [field.name, field.value]));
    expect(fields['Server address']).toBe('192.0.2.10:25570');
    expect(fields.Players).toBe('1/20');
  });

  test('rejects a port without an address', async () => {
    const command = loadCommands().find((item) => item.data.name === 'status');
    const interaction = {
      options: {
        getString: () => null,
        getInteger: () => 25570
      },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await command.execute(interaction, { db: { servers: { all: jest.fn() } } });

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('valid IP address or hostname')
    }));
    expect(minecraftServerUtil.status).not.toHaveBeenCalled();
  });
});

describe('Discord Minecraft account linking command', () => {
  const command = loadCommands().find((item) => item.data.name === 'link');

  test('completes the one-time Minecraft link code', async () => {
    const row = { minecraft_uuid: '123e4567-e89b-12d3-a456-426614174000', username: 'Player' };
    const interaction = {
      user: { id: 'discord-user' },
      member: { roles: { add: jest.fn().mockResolvedValue(undefined) } },
      options: { getString: () => 'ABC234' },
      reply: jest.fn().mockResolvedValue(undefined)
    };
    const ctx = {
      db: { config: { get: () => null } },
      links: { completeLink: jest.fn(() => row) }
    };

    await command.execute(interaction, ctx);

    expect(ctx.links.completeLink).toHaveBeenCalledWith('ABC234', 'discord-user');
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Player'),
      ephemeral: true
    }));
  });

  test('explains when the Minecraft account is already linked to another user', async () => {
    const interaction = {
      user: { id: 'discord-user' },
      options: { getString: () => 'ABC234' },
      reply: jest.fn().mockResolvedValue(undefined)
    };
    const ctx = {
      db: { config: { get: () => null } },
      links: { completeLink: jest.fn(() => { throw new Error('UUID_TAKEN'); }) }
    };

    await command.execute(interaction, ctx);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('already linked'),
      ephemeral: true
    }));
  });
});

describe('whitelist command permissions', () => {
  test('stops before removing when the async staff check denies access', async () => {
    const command = loadCommands().find((item) => item.data.name === 'whitelist');
    const interaction = {
      user: { id: 'user-1' },
      options: {
        getSubcommand: () => 'remove',
        getString: () => 'Steve'
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };
    const ctx = {
      requireStaff: jest.fn(async (target) => {
        await target.reply({ content: 'Not allowed.' });
        return false;
      }),
      whitelist: { remove: jest.fn() },
      staffLog: { add: jest.fn() }
    };

    await command.execute(interaction, ctx);

    expect(ctx.requireStaff).toHaveBeenCalledWith(interaction, 'mod');
    expect(ctx.whitelist.remove).not.toHaveBeenCalled();
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  describe('maintenance command', () => {
    const command = loadCommands().find((item) => item.data.name === 'maintenance');
    const server = { id: 7, name: 'Survival' };

    beforeEach(() => sendRcon.mockReset());

    test('runs RCON before updating maintenance state and records the action', async () => {
      const calls = [];
      sendRcon.mockImplementation(async (_env, _db, _server, rconCommand) => {
        calls.push(`rcon:${rconCommand}`);
        return { result: 'Whitelist enabled' };
      });
      const interaction = {
        user: { id: 'admin-1' },
        options: { getString: (name) => ({ state: 'on', server: null })[name] },
        deferReply: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue(undefined)
      };
      const ctx = {
        env: {},
        db: {
          servers: {
            all: () => [server],
            setMaintenance: jest.fn((_id, enabled) => calls.push(`database:${enabled}`))
          }
        },
        staffLog: { add: jest.fn() },
        status: { tick: jest.fn().mockResolvedValue(undefined) }
      };

      await command.execute(interaction, ctx);

      expect(calls).toEqual(['rcon:whitelist on', 'database:true']);
      expect(ctx.staffLog.add).toHaveBeenCalledWith(expect.objectContaining({
        actorId: 'admin-1',
        action: 'maintenance_on',
        targetName: 'Survival'
      }));
      expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Survival')
      }));
    });

    test('does not change the database when RCON fails', async () => {
      sendRcon.mockRejectedValue(new Error('RCON unavailable'));
      const interaction = {
        user: { id: 'admin-1' },
        options: { getString: (name) => ({ state: 'on', server: null })[name] },
        deferReply: jest.fn().mockResolvedValue(undefined)
      };
      const ctx = {
        env: {},
        db: {
          servers: {
            all: () => [server],
            setMaintenance: jest.fn()
          }
        }
      };

      await expect(command.execute(interaction, ctx)).rejects.toThrow('RCON unavailable');

      expect(ctx.db.servers.setMaintenance).not.toHaveBeenCalled();
    });

    test('asks which server to use when multiple servers are configured', async () => {
      const interaction = {
        options: { getString: (name) => ({ state: 'on', server: null })[name] },
        reply: jest.fn().mockResolvedValue(undefined)
      };
      const ctx = {
        db: { servers: { all: () => [server, { id: 8, name: 'Creative' }] } }
      };

      await command.execute(interaction, ctx);

      expect(sendRcon).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Survival, Creative')
      }));
    });
  });

  describe('ticket categories', () => {
    test('offers purchase, staff recruitment, support and other specialized intake forms', () => {
      const { ticketCategories } = require('../src/services/ticketCategories');
      const { ticketModal, ticketCategoryMenu } = require('../src/commands/tickets');

      expect(ticketCategories.support.fields.map((field) => field.id)).toContain('details');
      expect(ticketCategories.purchase.fields.map((field) => field.id)).toEqual(expect.arrayContaining([
        'item', 'order_reference', 'minecraft_name', 'details'
      ]));
      expect(ticketCategories.staff_recruitment.fields.map((field) => field.id)).toEqual(expect.arrayContaining([
        'role', 'timezone', 'experience'
      ]));
      expect(ticketCategories.technical).toBeDefined();
      expect(ticketCategories.player_report).toBeDefined();
      expect(ticketModal('purchase').toJSON().components).toHaveLength(4);
      expect(ticketCategoryMenu().toJSON().components[0].options).toHaveLength(Object.keys(ticketCategories).length);
    });
  });

  describe('staff role permissions', () => {
    const { memberTier, isStaff, requireTier } = require('../src/util/staff');
    const roleConfig = new Map([
      ['helper_role_id', 'helper'],
      ['mod_role_id', 'mod'],
      ['admin_role_id', 'admin'],
      ['developer_role_id', 'developer'],
      ['head_developer_role_id', 'head-developer'],
      ['owner_role_id', 'owner']
    ]);
    const db = { config: { get: (key) => roleConfig.get(key) } };

    test.each([
      ['helper', 'helper'],
      ['mod', 'mod'],
      ['admin', 'admin'],
      ['developer', 'developer'],
      ['head-developer', 'head-developer'],
      ['owner', 'owner']
    ])(
      'recognizes and grants staff access to the configured %s role',
      (role) => {
        const member = { roles: { cache: { has: (id) => id === role } } };
        expect(memberTier(member, db)).toBe(role);
        expect(isStaff(member, db)).toBe(true);
        expect(requireTier(member, db, 'helper')).toBe(true);
      }
    );

    test('grants head developers owner-level permissions', () => {
      const member = { roles: { cache: { has: (id) => id === 'head-developer' } } };
      expect(requireTier(member, db, 'admin')).toBe(true);
      expect(requireTier(member, db, 'owner')).toBe(true);
      expect(requireTier(member, db, 'head-developer')).toBe(true);
    });

    test('does not grant staff access to unrelated roles', () => {
      const member = { roles: { cache: { has: () => false } } };
      expect(isStaff(member, db)).toBe(false);
    });
  });

  describe('slash command dispatch', () => {
    test('removes requested commands and prevents duplicate registrations', () => {
      const commands = loadCommands();
      const names = commands.map((command) => command.data.name);

      expect(names).not.toEqual(expect.arrayContaining(['daily', 'topvoters', 'votes']));
      expect(new Set(names).size).toBe(names.length);

      const appeal = commands.find((command) => command.data.name === 'appeal');
      expect(appeal.data.toJSON().options.map((option) => option.name)).toEqual([
        'submit', 'status', 'add', 'cancel', 'withdraw', 'list', 'view',
        'accept', 'deny', 'reduce', 'note', 'assign', 'close', 'history'
      ]);
      expect(commands.some((command) => command.data.name === 'help')).toBe(true);
    });

    test('help lists registered commands with usage and descriptions', async () => {
      const commands = loadCommands();
      const help = commands.find((command) => command.data.name === 'help');
      const replies = [];
      const interaction = {
        user: { id: '123456789012345678' },
        options: { getString: () => 'all' },
        reply: jest.fn(async (payload) => replies.push(payload)),
        followUp: jest.fn(async (payload) => replies.push(payload))
      };
      const ctx = {
        client: { commands: new Map(commands.map((command) => [command.data.name, command])) },
        db: { config: { get: () => undefined } }
      };

      await help.execute(interaction, ctx);

      const pages = replies.flatMap((reply) => reply.embeds.map((item) => item.toJSON()));
      const pageCount = Number(pages[0].title.match(/· 1\/(\d+)$/)?.[1] || 1);
      const allPages = Array.from({ length: pageCount }, (_, pageIndex) =>
        help._test.createHelpPayload(ctx, 'all', pageIndex, '123456789012345678')
      )
        .flatMap((payload) => payload.embeds.map((item) => item.toJSON()));
      const fields = allPages.flatMap((page) => page.fields);
      const content = fields.map((field) => field.value).join('\n');
      expect(pages[0].title).toContain('Bai SMP Commands');
      expect(pages[0].title).toMatch(/· 1\/\d+$/);
      expect(pages[0].fields.length).toBeLessThanOrEqual(2);
      expect(replies[0].components).toHaveLength(1);
      expect(replies[0].components[0].components[1].data.disabled).toBe(false);
      expect(fields.map((field) => field.name)).toEqual(expect.arrayContaining([
        expect.stringContaining('Player tools'),
        expect.stringContaining('Staff tools'),
        expect.stringContaining('Server tools'),
        expect.stringContaining('Tickets'),
        expect.stringContaining('Community')
      ]));
      expect(content).toContain('`/appeal submit <reason> [ign] [case_id]` — Appeal an active ban or mute');
      expect(content).toContain('`/status [address] [port]` — Show the Minecraft server status');
      expect(content).toContain('`/ticketqueue [action] [status] [category] [number]` — List, filter, or remove support and recruitment tickets');
      expect(content).toContain('`/help [category]` — List bot commands and what they do');
      expect(replies).toHaveLength(1);
      expect(replies.every((reply) => reply.ephemeral && reply.embeds.length === 1)).toBe(true);
      expect(allPages.every((page) => page.fields.every((field) => field.value.length <= 1024))).toBe(true);
    });

    test('help page buttons are private to the user who opened the menu', async () => {
      const { handleInteraction } = require('../src/events/interactions');
      const commands = loadCommands();
      const ctx = {
        client: { commands: new Map(commands.map((command) => [command.data.name, command])) },
        db: { config: { get: () => undefined } }
      };
      const interaction = {
        user: { id: '123456789012345678' },
        customId: 'help:all:1:123456789012345678',
        isButton: () => true,
        update: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue(undefined)
      };

      await handleInteraction(interaction, ctx);

      expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
        embeds: [expect.objectContaining({
          data: expect.objectContaining({ title: expect.stringMatching(/· 2\//) })
        })]
      }));
      expect(interaction.reply).not.toHaveBeenCalled();

      const otherUser = {
        ...interaction,
        user: { id: '223456789012345678' },
        update: jest.fn(),
        reply: jest.fn().mockResolvedValue(undefined)
      };
      await handleInteraction(otherUser, ctx);
      expect(otherUser.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Only the person')
      }));
      expect(otherUser.update).not.toHaveBeenCalled();
    });

    test('replies when a command is no longer registered', async () => {
      const listeners = new Map();
      const client = {
        once: jest.fn(),
        on: jest.fn((event, handler) => listeners.set(event, handler))
      };
      attachBot({ client, db: {} });

      const interaction = {
        commandName: 'removed-command',
        user: { id: 'user-2' },
        isChatInputCommand: () => true,
        reply: jest.fn().mockResolvedValue(undefined)
      };
      await listeners.get('interactionCreate')(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('no longer available'),
        ephemeral: true
      }));
    });
  });

  describe('staff workflow tools', () => {
    test('shows a private player audit using the verified Discord-linked Minecraft account', async () => {
      const command = loadCommands().find((item) => item.data.name === 'playeraudit');
      const user = { id: 'discord-player', tag: 'Player#0001' };
      const history = [{
        case_id: 'C-1',
        type: 'tempban',
        active: 1,
        expires_at: Date.now() + 60_000,
        actor_discord_id: 'staff-1',
        reason: 'Repeated griefing'
      }];
      const getByDiscord = jest.fn(() => [{
        discord_id: user.id,
        minecraft_uuid: 'uuid-1',
        username: 'Steve'
      }]);
      const historyForTarget = jest.fn(() => history);
      const interaction = {
        options: {
          getUser: () => user,
          getString: () => null
        },
        reply: jest.fn().mockResolvedValue(undefined)
      };
      const ctx = {
        db: { config: { get: () => undefined }, raw: { prepare: jest.fn() } },
        links: { getByDiscord },
        moderation: { historyForTarget }
      };

      await command.execute(interaction, ctx);

      expect(getByDiscord).toHaveBeenCalledWith(user.id);
      expect(historyForTarget).toHaveBeenCalledWith({
        discordId: user.id,
        uuid: 'uuid-1',
        username: 'Steve'
      });
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
      const report = interaction.reply.mock.calls[0][0].embeds[0].toJSON();
      expect(report.title).toContain('Steve');
      expect(report.description).toContain('Repeated griefing');
      expect(report.fields.find((field) => field.name === 'Active punishments').value).toBe('1');
    });

    test('requires a Discord account or Minecraft username for player audit', async () => {
      const command = loadCommands().find((item) => item.data.name === 'playeraudit');
      const interaction = {
        options: { getUser: () => null, getString: () => null },
        reply: jest.fn().mockResolvedValue(undefined)
      };

      await command.execute(interaction, {
        db: { raw: { prepare: jest.fn() } },
        links: { getByDiscord: jest.fn() },
        moderation: { historyForTarget: jest.fn() }
      });

      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Provide either'),
        ephemeral: true
      }));
    });

    test('reports staff activity for a selected period and optional staff member', async () => {
      const command = loadCommands().find((item) => item.data.name === 'staffreport');
      const staff = { id: 'staff-1' };
      const interaction = {
        options: {
          getSubcommand: () => 'activity',
          getString: () => '7d',
          getUser: () => staff
        },
        reply: jest.fn().mockResolvedValue(undefined)
      };
      const activity = jest.fn(() => [
        { actor_discord_id: 'staff-1', action: 'ticket_close', count: 3 },
        { actor_discord_id: 'system', action: 'ticket_idle_close', count: 1 }
      ]);
      const ctx = {
        db: { config: { get: () => undefined } },
        staffLog: { activity }
      };

      await command.execute(interaction, ctx);

      expect(activity).toHaveBeenCalledWith(expect.objectContaining({
        actorId: 'staff-1',
        since: expect.any(String)
      }));
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        ephemeral: true,
        embeds: [expect.anything()]
      }));
      const report = interaction.reply.mock.calls[0][0].embeds[0].toJSON();
      expect(report.title).toContain('Last 7 days');
      expect(report.description).toContain('<@staff-1>');
      expect(report.description).toContain('System');
    });

    test('reports moderation action totals privately', async () => {
      const command = loadCommands().find((item) => item.data.name === 'staffreport');
      const interaction = {
        options: {
          getSubcommand: () => 'moderation',
          getString: () => '24h'
        },
        reply: jest.fn().mockResolvedValue(undefined)
      };
      const moderationSummary = jest.fn(() => ({
        total: 4,
        actions: [{ action: 'warn', count: 3 }, { action: 'tempban', count: 1 }]
      }));
      const ctx = {
        db: { config: { get: () => undefined } },
        staffLog: { moderationSummary }
      };

      await command.execute(interaction, ctx);

      expect(moderationSummary).toHaveBeenCalledWith({ since: expect.any(String) });
      const report = interaction.reply.mock.calls[0][0].embeds[0].toJSON();
      expect(report.title).toContain('Last 24 hours');
      expect(report.description).toContain('tempban');
      expect(report.fields[0].value).toBe('4');
    });

    test('filters audit results and caps output at 15 entries', async () => {
      const command = loadCommands().find((item) => item.data.name === 'staffreport');
      const staff = { id: 'staff-2' };
      const interaction = {
        options: {
          getSubcommand: () => 'audit',
          getString: (name) => ({ period: '30d', action: ' ban ' })[name],
          getUser: () => staff
        },
        reply: jest.fn().mockResolvedValue(undefined)
      };
      const auditSearch = jest.fn(() => [{
        case_id: 'C-1',
        actor_discord_id: 'staff-2',
        action: 'ban',
        target_name: 'Player',
        reason: 'Repeated griefing'
      }]);
      const ctx = {
        db: { config: { get: () => undefined } },
        staffLog: { auditSearch }
      };

      await command.execute(interaction, ctx);

      expect(auditSearch).toHaveBeenCalledWith(expect.objectContaining({
        actorId: 'staff-2',
        action: 'ban',
        limit: 15,
        since: expect.any(String)
      }));
      const report = interaction.reply.mock.calls[0][0].embeds[0].toJSON();
      expect(report.description).toContain('Repeated griefing');
    });

    test('shows case details privately from the staff logbook', async () => {
      const command = loadCommands().find((item) => item.data.name === 'logbook');
      const record = {
        case_id: 'C-20261007-ABCD1234',
        actor_discord_id: 'staff-1',
        target_discord_id: 'player-1',
        target_name: 'Player',
        action: 'warn',
        reason: 'Repeated spam',
        result: 'warning issued',
        metadata: '{"source":"discord"}',
        created_at: '2026-10-07 02:00:00'
      };
      const interaction = {
        options: {
          getSubcommand: () => 'case',
          getString: () => ` ${record.case_id} `
        },
        reply: jest.fn().mockResolvedValue(undefined)
      };
      const ctx = {
        db: { config: { get: () => undefined } },
        staffLog: { getByCase: jest.fn(() => record) }
      };

      await command.execute(interaction, ctx);

      expect(ctx.staffLog.getByCase).toHaveBeenCalledWith(record.case_id);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        ephemeral: true,
        embeds: [expect.anything()]
      }));
      const fields = Object.fromEntries(interaction.reply.mock.calls[0][0].embeds[0].toJSON().fields
        .map((field) => [field.name, field.value]));
      expect(fields.Action).toBe('warn');
      expect(fields.Actor).toBe('<@staff-1>');
      expect(fields.Reason).toBe('Repeated spam');
      expect(fields.Metadata).toContain('"source":"discord"');
    });

    test('exports all audit columns as escaped CSV cells', async () => {
      const command = loadCommands().find((item) => item.data.name === 'logbook');
      const interaction = {
        options: { getSubcommand: () => 'export' },
        reply: jest.fn().mockResolvedValue(undefined)
      };
      const ctx = {
        staffLog: {
          allForExport: () => [{
            case_id: 'C-1',
            target_name: '=cmd',
            reason: 'quoted, "reason"\nnext line'
          }]
        }
      };

      await command.execute(interaction, ctx);

      const file = interaction.reply.mock.calls[0][0].files[0];
      const csv = file.attachment.toString();
      expect(csv).toContain('"case_id","actor_discord_id","target_discord_id"');
      expect(csv).toContain("\"'=cmd\"");
      expect(csv).toContain('"quoted, ""reason""\nnext line"');
    });

    test('filters the private ticket queue by the selected category', async () => {
      const command = loadCommands().find((item) => item.data.name === 'ticketqueue');
      const interaction = {
        options: {
          getString: (name) => ({
            action: 'list',
            status: 'open',
            category: 'staff_recruitment'
          })[name],
          getInteger: () => null
        },
        reply: jest.fn().mockResolvedValue(undefined)
      };
      const ticket = {
        number: 14,
        category: 'Staff recruitment',
        channel_id: 'ticket-channel',
        discord_id: 'applicant-1',
        claimed_by: 'staff-2',
        created_at: '2026-10-07 01:00:00'
      };
      const list = jest.fn(() => [ticket]);
      const ctx = {
        db: { config: { get: () => undefined } },
        tickets: { list }
      };

      await command.execute(interaction, ctx);

      expect(list).toHaveBeenCalledWith('open', 'Staff recruitment');
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        ephemeral: true,
        allowedMentions: { parse: [] }
      }));
      const description = interaction.reply.mock.calls[0][0].embeds[0].toJSON().description;
      expect(description).toContain('Staff recruitment');
      expect(description).toContain('<#ticket-channel>');
      expect(description).toContain('<@staff-2>');
    });

    test('lists closed tickets when the closed filter is selected', async () => {
      const command = loadCommands().find((item) => item.data.name === 'ticketqueue');
      const ticket = {
        number: 10,
        category: 'General support',
        channel_id: 'old-ticket-channel',
        discord_id: 'player-1',
        claimed_by: null,
        created_at: '2026-10-07 01:00:00'
      };
      const list = jest.fn(() => [ticket]);
      const interaction = {
        options: {
          getString: (name) => ({ action: 'list', status: 'closed', category: null })[name],
          getInteger: () => null
        },
        reply: jest.fn().mockResolvedValue(undefined)
      };

      await command.execute(interaction, {
        db: { config: { get: () => undefined } },
        tickets: { list }
      });

      expect(list).toHaveBeenCalledWith('closed', null);
      expect(interaction.reply.mock.calls[0][0].embeds[0].toJSON().title).toBe('Closed ticket queue');
    });

    test('requires confirmation before removing a ticket from the queue', async () => {
      const command = loadCommands().find((item) => item.data.name === 'ticketqueue');
      const interaction = {
        user: { id: '12345678901234567' },
        options: {
          getString: (name) => ({ action: 'remove', status: 'open', category: null })[name],
          getInteger: () => 14
        },
        reply: jest.fn().mockResolvedValue(undefined)
      };

      await command.execute(interaction, {
        db: { config: { get: () => undefined } },
        tickets: {
          getByNumber: () => ({ number: 14, status: 'open' })
        }
      });

      const response = interaction.reply.mock.calls[0][0];
      expect(response.content).toContain('transcript will be saved');
      expect(response.components[0].toJSON().components.map((component) => component.custom_id)).toEqual([
        'ticket_remove_confirm:14:12345678901234567',
        'ticket_remove_cancel:14:12345678901234567'
      ]);
    });

    test('diagnostics includes actionable query and RCON outcomes', async () => {
      const { diagnostics, diagnosticFailure, pluginApiLoopbackMisconfiguration } = require('../src/http/server');
      minecraftServerUtil.status.mockResolvedValue({
        players: { online: 1, max: 30, sample: [] },
        version: { name: 'Paper 1.21.11' },
        motd: { clean: 'Online' },
        roundTripLatency: 20
      });
      sendRcon.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
      const server = {
        name: 'Survival',
        host: 'play.example.net',
        query_port: 12329,
        rcon_port: 25575,
        plugin_api_url: ''
      };
      const ctx = {
        client: { isReady: () => true },
        env: {},
        db: {
          raw: { prepare: () => ({ get: () => ({ ok: 1 }) }) },
          config: { get: () => undefined }
        }
      };

      const checks = await diagnostics(ctx, server);
      const byName = Object.fromEntries(checks.map((check) => [check.name, check]));

      expect(byName.Discord.ok).toBe(true);
      expect(byName.RCON).toMatchObject({
        ok: false,
        detail: expect.stringContaining('set MC_RCON_HOST and MC_RCON_PORT to those allocated values')
      });
      expect(byName['Minecraft query']).toMatchObject({ ok: true, detail: expect.stringContaining('1/30 players') });
      expect(byName['Plugin API'].detail).toContain('No plugin API URL');
      expect(diagnosticFailure(Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
      }))).toContain('Connection refused');
      expect(diagnosticFailure(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })))
        .toContain('host firewall allows this bot');
      expect(pluginApiLoopbackMisconfiguration({
        host: 'baismp.playwithbao.com',
        plugin_api_url: 'http://127.0.0.1:8765'
      })).toBe(true);
      expect(pluginApiLoopbackMisconfiguration({
        host: '127.0.0.1',
        plugin_api_url: 'http://127.0.0.1:8765'
      })).toBe(false);
    });

    test('explains why remote localhost plugin URLs cannot work', async () => {
      const { diagnostics } = require('../src/http/server');
      const server = {
        name: 'Survival',
        host: 'baismp.playwithbao.com',
        query_port: 12329,
        rcon_port: 25575,
        plugin_api_url: 'http://127.0.0.1:8765'
      };
      const ctx = {
        client: { isReady: () => true },
        env: {},
        db: {
          raw: { prepare: () => ({ get: () => ({ ok: 1 }) }) },
          config: { get: () => undefined }
        }
      };
      sendRcon.mockResolvedValueOnce({ result: 'There are 1 out of maximum 30 players online.' });
      minecraftServerUtil.status.mockResolvedValue({
        players: { online: 1, max: 30, sample: [] },
        version: { name: 'Paper 1.21.11' },
        motd: { clean: 'Online' },
        roundTripLatency: 20
      });

      const checks = await diagnostics(ctx, server);
      const plugin = checks.find((check) => check.name === 'Plugin API');

      expect(plugin).toMatchObject({
        ok: false,
        detail: expect.stringContaining('points to the bot PC')
      });
    });
  });
});
