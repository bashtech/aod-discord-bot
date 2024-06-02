/* jshint esversion: 8 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('aod')
		.setDescription('Legacy command processing using the original text/prefix format.')
		.addStringOption(option => option.setName('command').setDescription('The legacy command excluding command prefix')),
	async execute(interaction, guild, member, perm) {
		//get command and argument string
		const input = interaction.options.getString('command');
		let first_space = input.indexOf(' ');
		let command, arg_string;
		if (first_space < 0) {
			command = input.trim();
			arg_string = "";
		} else {
			command = input.slice(0, first_space);
			arg_string = input.slice(first_space + 1).trim();
		}

		global.processCommand(interaction, member, command, arg_string, guild, perm, false);
	},
};
