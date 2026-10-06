require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { loadCommands } = require('../src/commands');

async function deploy() {
  const commands = loadCommands().map((c) => c.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const route = process.env.DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID)
    : Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);
  const scope = process.env.DISCORD_GUILD_ID ? 'guild' : 'global';

  console.log(`Deploying ${scope} slash commands`);
  try {
    await rest.put(route, { body: commands });
    console.log(`Successfully deployed ${commands.length} ${scope} commands`);
  } catch (err) {
    console.error(`❌ ${scope} command deployment failed: ${err.message}`);
    console.error('\nTroubleshooting steps:');
    console.error('1. Go to https://discord.com/developers/applications');
    console.error('2. Select your application (ID: ' + process.env.DISCORD_CLIENT_ID + ')');
    console.error('3. Confirm DISCORD_CLIENT_ID matches this application and DISCORD_GUILD_ID matches the target server.');
    console.error('4. Confirm this bot is a member of the target server and was invited with the applications.commands scope.');
    process.exit(1);
  }
}

deploy();
