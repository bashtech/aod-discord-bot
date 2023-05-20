/* jshint esversion: 8 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('flip')
		.setDescription('Flip a coin'),
	async execute(interaction) {
		let result = Math.floor(Math.random() * 2);
		if (result > 0)
			return interaction.reply(`Heads`);
		else
			return interaction.reply(`Tails`);
	},
};
