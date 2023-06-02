/* jshint esversion: 8 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('list')
		.setDescription('List subscribable roles.')
		.addSubcommand(command => command.setName('my_roles').setDescription('Lists your current and available subscribable roles'))
		.addSubcommand(command => command.setName('user_roles').setDescription('Lists current and available assignable roles for another user (requires Moderator permissions)')
			.addUserOption(option => option.setName('target').setDescription('Target User').setRequired(true)))
		.addSubcommand(command => command.setName('role').setDescription('Role to display (requires Moderator permissions)')
			.addStringOption(option => option.setName('target').setDescription('Target Role').setAutocomplete(true).setRequired(true))),
	async autocomplete(interaction, member, perm, permName) {
		const subCommand = interaction.options.getSubcommand();
		const focusedOption = interaction.options.getFocused(true);
		let search = focusedOption.value.toLowerCase();
		switch (subCommand) {
			case 'role':
				if (focusedOption.name === 'target') {
					if (perm >= global.PERM_MOD) {
						let count = 0;
						let options = interaction.guild.roles.cache.filter(r => {
							if (count >= 25) {
								return false;
							} else if (r.name.toLowerCase().startsWith(search)) {
								count++;
								return true;
							}
							return false; });
						await interaction.respond(options.map(r => ({ name: r.name, value: r.name })));
						return;
					}
				}
				break;
			default:
				break;
		}
	},
	async execute(interaction, member, perm, permName) {
		const subCommand = interaction.options.getSubcommand();
		switch (subCommand) {
			case 'my_roles':
				await global.listRoles(interaction, member, interaction.guild, member, false);
				return;
			case 'user_roles':
			if (perm < global.PERM_MOD) {
					return interaction.reply({ content: "You do not have permissions to assign roles", ephemeral: true });
				}
				let targetMember = interaction.options.getMember('target');
				await global.listRoles(interaction, member, interaction.guild, member, true);
				return;
			case 'role':
				if (perm < global.PERM_MOD) {
					return interaction.reply({ content: "You do not have permissions to show role members", ephemeral: true });
				}
				await global.listMembers(interaction, member, interaction.guild, interaction.options.getString('target'));
				return;
			default:
				break;
		}
	}
};
