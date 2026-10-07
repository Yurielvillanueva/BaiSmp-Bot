const { notifyStaffError, replyError } = require('../src/util/errors');

function notificationContext() {
  const send = jest.fn().mockResolvedValue(undefined);
  const channel = { isTextBased: () => true, send };
  const ctx = {
    env: {
      ERROR_CHANNEL_ID: 'staff-errors',
      ERROR_NOTIFY_ROLE_ID: 'head-developers'
    },
    db: {
      config: { get: () => undefined },
      servers: { all: () => [] }
    },
    client: {
      channels: { fetch: jest.fn().mockResolvedValue(channel) }
    }
  };
  return { ctx, channel, send };
}

describe('staff error notifications', () => {
  test('posts command failures to the configured staff channel and mentions only the staff role', async () => {
    const { ctx, send } = notificationContext();

    await expect(notifyStaffError(ctx, new Error('RCON unavailable'), {
      command: 'backup',
      userId: 'discord-user'
    })).resolves.toBe(true);

    expect(ctx.client.channels.fetch).toHaveBeenCalledWith('staff-errors');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      content: '<@&head-developers>',
      allowedMentions: {
        roles: ['head-developers'],
        users: [],
        repliedUser: false
      }
    }));
    const fields = send.mock.calls[0][0].embeds[0].toJSON().fields;
    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Command', value: 'backup' }),
      expect.objectContaining({ name: 'User', value: '<@discord-user>' }),
      expect.objectContaining({ name: 'Error', value: 'RCON unavailable' })
    ]));
  });

  test('reports a backup configuration issue to the requester and staff', async () => {
    const { ctx, send } = notificationContext();
    const interaction = {
      deferred: true,
      replied: false,
      commandName: 'backup',
      user: { id: 'discord-user' },
      editReply: jest.fn().mockResolvedValue(undefined)
    };
    const error = Object.assign(new Error('MC_WORLD_PATH is not configured'), {
      code: 'BACKUP_WORLD_PATH_MISSING'
    });

    await replyError(interaction, ctx, error);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('configure MC_WORLD_PATH')
    }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('logs a notification setup error instead of silently swallowing it', async () => {
    const { ctx } = notificationContext();
    ctx.client.channels.fetch.mockRejectedValue(new Error('Discord unavailable'));
    const { logger } = require('../src/logger');
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);

    try {
      await expect(notifyStaffError(ctx, new Error('command failure'))).resolves.toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ channelId: 'staff-errors' }),
        'failed to notify staff about bot error'
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
