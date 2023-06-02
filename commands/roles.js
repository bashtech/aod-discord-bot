/* jshint esversion: 8 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('roles')
		.setDescription('Manage user roles.')
		.addSubcommand(command => command.setName('list').setDescription('Lists your current and available subscribable roles'))
		.addSubcommand(command => command.setName('list_user').setDescription('Lists current and available assignable roles for another user (requires Moderator permissions)')
			.addUserOption(option => option.setName('user').setDescription('User').setRequired(true)))
		.addSubcommand(command => command.setName('members').setDescription('Show members of a role (requires Moderator permissions)')
			.addRoleOption(option => option.setName('role').setDescription('Role').setRequired(true)))
		.addSubcommand(command => command.setName('sub').setDescription('Subscribe to a role')
			.addStringOption(option => option.setName('role').setDescription('Role').setAutocomplete(true).setRequired(true))),
	async autocomplete(interaction, member, perm, permName) {
		const subCommand = interaction.options.getSubcommand();
		const focusedOption = interaction.options.getFocused(true);
		let search = focusedOption.value.toLowerCase();
		switch (subCommand) {
			case 'sub':
				if (focusedOption.name === 'role') {
					let count = 0;
					let options = global.getSubscribableRoles().filter(r => {
						if (count >= 25) {
							return false;
						} else if (r.toLowerCase().startsWith(search)) {
							count++;
							return true;
						}
						return false; });
					await interaction.respond(options.sort().map(r => ({ name: r, value: r })));
					return;
				}
				break;
		}
	},
	async execute(interaction, member, perm, permName) {
		const subCommand = interaction.options.getSubcommand();
		switch (subCommand) {
			case 'list':
				await global.listRoles(interaction, member, interaction.guild, member, false);
				return;
			case 'list_user':
			if (perm < global.PERM_MOD) {
					return interaction.reply({ content: "You do not have permissions to assign roles", ephemeral: true });
				}
				let targetMember = interaction.options.getMember('user');
				await global.listRoles(interaction, member, interaction.guild, targetMember, true);
				return;
			case 'members':
				if (perm < global.PERM_MOD) {
					return interaction.reply({ content: "You do not have permissions to show role members", ephemeral: true });
				}
				let role = interaction.options.getRole('role');
				await global.listMembers(interaction, member, interaction.guild, role.name);
				return;
			default:
				return interaction.reply({ content: "Not implemented", ephemeral: true });
		}
	}
};
