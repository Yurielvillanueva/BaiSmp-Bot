const { EmbedBuilder } = require('discord.js');
const { cfg } = require('../config/store');

function theme(db) {
  return {
    color: cfg(db, 'embed_color') || cfg(db, 'theme')?.color || 0x2ecc71,
    footer: cfg(db, 'embed_footer') || cfg(db, 'theme')?.footer || 'MC Bridge'
  };
}

function embed(db, { title, description, fields, color }) {
  const th = theme(db);
  const e = new EmbedBuilder()
    .setColor(color || th.color)
    .setTimestamp(new Date())
    .setFooter({ text: th.footer });
  if (title) e.setTitle(title);
  if (description) e.setDescription(description);
  if (fields?.length) e.addFields(fields);
  return e;
}

module.exports = { theme, embed };
