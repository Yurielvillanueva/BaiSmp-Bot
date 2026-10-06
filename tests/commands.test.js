const { loadCommands } = require('../src/commands');
const { attachBot } = require('../src/bot');
jest.mock('../src/services/rcon', () => ({ sendRcon: jest.fn() }));
const { sendRcon } = require('../src/services/rcon');

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

  describe('slash command dispatch', () => {
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
});
