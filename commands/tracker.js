/* jshint esversion: 11 */

const {
	SlashCommandBuilder,
} = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('tracker')
		.setDescription('Queries AOD Tracker for information')

		.addSubcommandGroup(command => command.setName('search').setDescription('Search for members in AOD Tracker')
			.addSubcommand(command => command.setName('name').setDescription('Search for members in AOD Tracker by AOD username')
				.addStringOption(option => option.setName('username').setDescription('AOD Username').setRequired(true)))
			.addSubcommand(command => command.setName('discord').setDescription('Search for members in AOD Tracker by Discord user')
				.addUserOption(option => option.setName('user').setDescription('Discord User').setRequired(true)))
			.addSubcommand(command => command.setName('teamspeak').setDescription('Search for members in AOD Tracker by TeamSpeak unique ID')
				.addStringOption(option => option.setName('unique-id').setDescription('TeamSpeak Unique ID').setRequired(true))))
		.addSubcommand(command => command.setName('division').setDescription('Query basic division information')
			.addStringOption(option => option.setName('name').setDescription('Division name or abbreviation').setRequired(true))),
	help: true,
	checkPerm(perm, commandName, parentName) {
		if (parentName === 'search') {
			switch (commandName) {
				case 'name':
				case 'discord':
				case 'teamspeak':
					return perm >= global.PERM_MEMBER;
			}
		} else {
			switch (commandName) {
				case 'tracker':
				case 'division':
					return perm >= global.PERM_MEMBER;
			}
		}
		return false;
	},
	async execute(interaction, guild, member, perm) {
		await interaction.deferReply();
		const subCommand = interaction.options.getSubcommand();
		const commandGroup = interaction.options.getSubcommandGroup(false);

		let trackerCommand;
		let field;
		let value;
		if (commandGroup === null) {
			switch (subCommand) {
				case 'division': {
					trackerCommand = 'division';
					value = interaction.options.getString('name');
					break;
				}
			}
		} else if (commandGroup === 'search') {
			trackerCommand = 'member';
			switch (subCommand) {
				case 'name': {
					field = 'name';
					value = interaction.options.getString('username');
					break;
				}
				case 'discord': {
					field = 'discord';
					value = interaction.options.getUser('user').username;
					break;
				}
				case 'teamspeak': {
					field = 'ts_unique_id';
					value = interaction.options.getString('unique-id');
					break;
				}
			}
		}

		try {
			const trackerURL = new URL(`${global.config.trackerURL}/bot/commands/${trackerCommand}`);
			trackerURL.searchParams.append('token', global.config.trackerToken);
			if (field)
				trackerURL.searchParams.append('field', field);
			trackerURL.searchParams.append('value', value);
			let response = await fetch(trackerURL, {
				method: 'GET',
				headers: {
					'User-Agent': 'Discord Bot',
					'Accept': 'application/json'
				}
			});
			let body = await response.json();
			if (body.embed)
				return global.messageReply(interaction, { embeds: [body.embed] });
			else if (body.message)
				return global.messageReply(interaction, body.message);
			else
				return global.messageReply(interaction, 'There was an error processing the request');
		} catch (e) {
			return global.messageReply(interaction, 'There was an error processing the request');
		}

	}
};
