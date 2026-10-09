const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const { embed, theme } = require('../util/embeds');
const { isStaff } = require('../util/staff');

const PLAYER_COMMANDS = new Set(['appeal', 'link', 'online', 'playtime', 'stats', 'status', 'top', 'unlink', 'whois']);
const SERVER_COMMANDS = new Set([
  'backup', 'console', 'diagnostics', 'killswitch', 'maintenance', 'perf', 'restart', 'server'
]);
const TICKET_COMMANDS = new Set(['ticketpanel', 'ticketqueue']);
const CATEGORY_INFO = {
  all: { label: 'All commands', icon: '✨', color: 0x5865f2 },
  player: { label: 'Player tools', icon: '👤', color: 0x57f287 },
  staff: { label: 'Staff tools', icon: '🛡️', color: 0xed4245 },
  server: { label: 'Server tools', icon: '🖥️', color: 0x5865f2 },
  tickets: { label: 'Tickets', icon: '🎟️', color: 0xfee75c },
  community: { label: 'Community', icon: '🎉', color: 0xeb459e }
};
const CATEGORY_ORDER = ['player', 'staff', 'server', 'tickets', 'community'];
const FIELD_LIMIT = 1000;
const EMBED_TEXT_LIMIT = 5200;
const FIELDS_PER_PAGE = 2;

function commandCategory(command) {
  const name = command.data.name;
  if (command.staff) return 'staff';
  if (PLAYER_COMMANDS.has(name)) return 'player';
  if (TICKET_COMMANDS.has(name)) return 'tickets';
  if (SERVER_COMMANDS.has(name)) return 'server';
  if (['ban', 'kick', 'mute', 'tempban', 'warn', 'whitelist'].includes(name)) return 'staff';
  return 'community';
}

function optionSyntax(option) {
  const value = option.type === 6 ? '@user'
    : option.type === 7 ? '#channel'
      : option.type === 8 ? '@role'
        : option.name;
  return option.required ? `<${value}>` : `[${value}]`;
}

function formatAction(path, description, options = []) {
  const args = options
    .filter((option) => option.type !== 1 && option.type !== 2)
    .map(optionSyntax)
    .join(' ');
  const signature = `${path}${args ? ` ${args}` : ''}`;
  return `• \`${signature}\` — ${description || 'No description provided.'}`;
}

function describeCommand(command) {
  const json = command.data.toJSON();
  const options = json.options || [];
  const actions = options.filter((option) => option.type === 1 || option.type === 2);
  if (!actions.length) return [formatAction(`/${json.name}`, json.description, options)];

  return actions.flatMap((action) => {
    if (action.type !== 2) {
      return [formatAction(`/${json.name} ${action.name}`, action.description, action.options || [])];
    }
    return (action.options || []).map((nested) =>
      formatAction(`/${json.name} ${action.name} ${nested.name}`, nested.description, nested.options || [])
    );
  });
}

function categorizeCommandActions(command) {
  const json = command.data.toJSON();
  const options = json.options || [];
  const actions = options.filter((option) => option.type === 1 || option.type === 2);
  const entries = !actions.length
    ? [{ description: json.description, text: formatAction(`/${json.name}`, json.description, options) }]
    : actions.flatMap((action) => {
      if (action.type !== 2) {
        return [{
          description: action.description,
          text: formatAction(`/${json.name} ${action.name}`, action.description, action.options || [])
        }];
      }
      return (action.options || []).map((nested) => ({
        description: nested.description,
        text: formatAction(`/${json.name} ${action.name} ${nested.name}`, nested.description, nested.options || [])
      }));
    });

  return entries.map(({ description, text }) => {
    const isStaffAction = /^staff:\s*/i.test(description || '');
    return {
      category: isStaffAction ? 'staff' : commandCategory(command),
      text: isStaffAction ? text.replace(/ — Staff:\s*/i, ' — ') : text
    };
  });
}

function splitCategory(category, entries, maxLength = FIELD_LIMIT) {
  const chunks = [];
  let chunk = '';
  for (const entry of entries) {
    const next = chunk ? `${chunk}\n\n${entry}` : entry;
    if (next.length > maxLength && chunk) {
      chunks.push(chunk);
      chunk = entry;
    } else {
      chunk = next;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks.map((value, index) => ({
    name: `${CATEGORY_INFO[category].icon} ${CATEGORY_INFO[category].label}${chunks.length > 1 ? ` · ${index + 1}/${chunks.length}` : ''}`,
    value,
    inline: false
  }));
}

function buildFields(commands, selected) {
  const categories = selected === 'all'
    ? CATEGORY_ORDER.filter((category) => category !== 'staff')
    : [selected];
  return categories.flatMap((category) => {
    const entries = commands
      .flatMap(categorizeCommandActions)
      .filter((entry) => entry.category === category)
      .map((entry) => entry.text);
    return entries.length ? splitCategory(category, entries) : [];
  });
}

function splitFields(fields, maxLength = EMBED_TEXT_LIMIT, maxFields = FIELDS_PER_PAGE) {
  const pages = [];
  let page = [];
  let length = 0;
  for (const field of fields) {
    const fieldLength = field.name.length + field.value.length;
    if (page.length && (length + fieldLength > maxLength || page.length >= maxFields)) {
      pages.push(page);
      page = [];
      length = 0;
    }
    page.push(field);
    length += fieldLength;
  }
  if (page.length) pages.push(page);
  return pages;
}

function helpEmbed(db, { selected, page, pageIndex, pageCount, actionCount }) {
  const category = CATEGORY_INFO[selected];
  const suffix = pageCount > 1 ? ` · ${pageIndex + 1}/${pageCount}` : '';
  return embed(db, {
    title: `${category.icon} Bai SMP Commands${suffix}`,
    description: selected === 'all'
      ? `**${actionCount} actions** · Filter with \`/help category:\`.`
      : `**${category.label}** · ${actionCount} ${actionCount === 1 ? 'action' : 'actions'}.`,
    fields: page
  }).setColor(selected === 'all' ? theme(db).color : category.color)
    .setFooter({
      text: `Use /help to browse commands${suffix}`
    });
}

function createHelpPayload(ctx, selected, pageIndex) {
    const commands = [...ctx.client.commands.values()]
      .sort((a, b) => a.data.name.localeCompare(b.data.name));
    const fields = buildFields(commands, selected);
    const actionCount = commands
      .flatMap(categorizeCommandActions)
      .filter((entry) => selected === 'all'
        ? entry.category !== 'staff'
        : entry.category === selected)
      .length;
    const pages = splitFields(fields);
    const currentIndex = Math.max(0, Math.min(pageIndex, pages.length - 1));
    const components = pages.length > 1
      ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`help:${selected}:${Math.max(0, currentIndex - 1)}`)
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('◀️')
          .setDisabled(currentIndex === 0),
        new ButtonBuilder()
          .setCustomId(`help:${selected}:${Math.min(pages.length - 1, currentIndex + 1)}`)
          .setLabel('Next')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('▶️')
          .setDisabled(currentIndex === pages.length - 1)
      )]
      : [];

    return {
      embeds: [helpEmbed(ctx.db, {
        selected,
        page: pages[currentIndex] || [],
        pageIndex: currentIndex,
        pageCount: pages.length,
        actionCount
      })],
      components,
    };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('List bot commands and what they do')
    .addStringOption((option) => option
      .setName('category')
      .setDescription('Show all commands or filter by category')
      .addChoices(
        { name: 'All commands', value: 'all' },
        { name: 'Player', value: 'player' },
        { name: 'Staff', value: 'staff' },
        { name: 'Server', value: 'server' },
        { name: 'Tickets', value: 'tickets' },
        { name: 'Community', value: 'community' }
      )),
  async execute(interaction, ctx) {
    const selected = interaction.options.getString('category') || 'all';
    if (selected === 'staff' && !isStaff(interaction.member, ctx.db)) {
      await interaction.reply({
        content: 'Staff tools are only available to members with a configured staff role.',
        ephemeral: true
      });
      return;
    }
    const commands = [...ctx.client.commands.values()]
      .sort((a, b) => a.data.name.localeCompare(b.data.name));
    const fields = buildFields(commands, selected);
    if (!fields.length) {
      await interaction.reply({ content: 'No commands found in that category.', ephemeral: true });
      return;
    }

    await interaction.reply({
      ...createHelpPayload(ctx, selected, 0),
      ...(selected === 'staff' ? { ephemeral: true } : {})
    });
  }
};

module.exports._test = {
  commandCategory, describeCommand, categorizeCommandActions, splitCategory, splitFields, helpEmbed,
  createHelpPayload, CATEGORY_INFO
};
