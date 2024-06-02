/* jshint esversion: 8 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('login')
		.setDescription('Associate discord user to AOD forum account')
		.addStringOption(option => option.setName('username').setDescription('ClanAOD.net Forum Username').setRequired(true))
		.addStringOption(option => option.setName('password').setDescription('ClanAOD.net Forum Password').setRequired(true)),
	global: true,
	help: true,
	async execute(interaction, guild, member, perm) {
		let username = interaction.options.getString('username');
		let password = interaction.options.getString('password');
		return global.userLogin(interaction, member, guild, username, password);
	},
};
