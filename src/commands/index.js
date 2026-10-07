const fs = require('fs');
const path = require('path');

function loadCommands() {
  const commands = [];
  const names = new Set();
  const dir = path.join(__dirname);
  function walk(d) {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.js') && name !== 'index.js') {
        const mod = require(full);
        const list = Array.isArray(mod) ? mod : [mod];
        for (const item of list) {
          if (item.data && item.execute) {
            const name = item.data.name;
            if (names.has(name)) throw new Error(`Duplicate slash command registration: /${name}`);
            names.add(name);
            if (item.staff) item.data.setDefaultMemberPermissions(null);
            commands.push(item);
          }
        }
      }
    }
  }
  walk(dir);
  return commands;
}

module.exports = { loadCommands };
