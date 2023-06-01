/* jshint esversion: 8 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('list')
		.setDescription('List subscribable roles.')
		.addStringOption(option => option.setName('role').setDescription('Role to display (requires Moderator permissions)').setAutocomplete(true)),
	async autocomplete(interaction, member, perm, permName) {
		const focusedOption = interaction.options.getFocused(true);
		if (focusedOption.name === 'role') {
			if (perm >= global.PERM_MOD) {
				let count = 0;
				let options = interaction.guild.roles.cache.filter(r => { return count++ < 25 && r.name.startsWith(focusedOption.value); });
				interaction.respond(options.map(r => ({ name: r.name, value: r.name })));
				return;
			}
		}
		interaction.respond([]);
	},
	async execute(interaction, member, perm, permName) {
		interaction.reply({ content: "Not yet implemented", ephemeral: true });
	}
};
