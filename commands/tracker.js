/* jshint esversion: 11 */

const {
	SlashCommandBuilder,
} = require('discord.js');
const config = require("../config/aod-discord-bot.config.json");

module.exports = {
	data: new SlashCommandBuilder()
		.setName('tracker')
		.setDescription('Queries AOD Tracker for information')

		.addSubcommand(command => command.setName('search').setDescription('Search for members in AOD Tracker by AOD username')
			.addStringOption(option => option.setName('username').setDescription('AOD Username').setRequired(true)))
		.addSubcommand(command => command.setName('search-discord').setDescription('Search for members in AOD Tracker by Discord user')
			.addUserOption(option => option.setName('user').setDescription('Discord User').setRequired(true)))
		.addSubcommand(command => command.setName('search-teamspeak').setDescription('Search for members in AOD Tracker by TeamSpeak unique ID')
			.addStringOption(option => option.setName('unique-id').setDescription('TeamSpeak Unique ID').setRequired(true)))
		.addSubcommand(command => command.setName('division').setDescription('Query basic division information')
			.addStringOption(option => option.setName('abbreviation').setDescription('Division Abbreviation').setRequired(true))),
	help: true,
	checkPerm(perm, commandName) {
		switch (commandName) {
			case 'tracker':
			case 'search':
			case 'search-discord':
			case 'search-teamspeak':
			case 'division':
				return perm >= global.PERM_MEMBER;
		}
		return false;
	},
	async execute(interaction, member, perm, permName) {
		await interaction.deferReply();
		const subCommand = interaction.options.getSubcommand();

		let query;
		switch (subCommand) {
			case 'search': {
				query = interaction.options.getString('username');
				break;
			}
			case 'search-discord': {
				query = interaction.options.getUser('user').username;
				break;
			}
			case 'search-teamspeak': {
				query = interaction.options.getString('unique-id');
				break;
			}
			case 'division': {
				query = interaction.options.getString('abbreviation');
				break;
			}
		}

		try {
			let data = new URLSearchParams();
			data.append('type', 'discord');
			data.append('text', `${subCommand}:${query}`);
			data.append('token', global.config.trackerToken);

			let response = await fetch(`${global.config.trackerURL}/slack`, {
				method: 'post',
				body: data,
				headers: {
					'User-Agent': 'Discord Bot',
					'Accept': 'application/json'
				}
			});
			let body = await response.json();
			if (body.embed)
				return global.messageReply(interaction, { embeds: [body.embed] });
			else if (body.text)
				return global.messageReply(interaction, body.text);
			else
				return global.messageReply(interaction, 'There was an error processing the request');
		} catch (e) {
			return global.messageReply(interaction, 'There was an error processing the request');
		}

	}
};
