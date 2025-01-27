/* jshint esversion: 11 */

const fs = require('fs');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { clientId, guildId, token } = require('./config/aod-discord-bot.config.json');

const commands = [];
const globalCommands = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
	const command = require(`./commands/${file}`);
	commands.push(command.data.toJSON());
	if (command.global === true) {
		globalCommands.push(command.data.toJSON());
	}
	if (command.menuCommands) {
		command.menuCommands.forEach(m => {
			commands.push(m.toJSON());
			if (command.global === true) {
				globalCommands.push(m.toJSON());
			}
		});
	}
}

const rest = new REST({ version: '9' }).setToken(token);

(async () => {
	try {
		await rest.put(
			Routes.applicationGuildCommands(clientId, guildId), { body: commands },
		);
		await rest.put(
			Routes.applicationCommands(clientId), { body: globalCommands },
		);

		console.log('Successfully registered application commands.');
	} catch (error) {
		console.error(error);
	}
})();
