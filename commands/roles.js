/* jshint esversion: 11 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

function sortAndLimitOptions(options, len, search) {
	let count = 0;
	return options
		.sort()
		.filter(o => {
			if (count >= len) {
				return false;
			} else if (o.toLowerCase().startsWith(search)) {
				count++;
				return true;
			} else {
				return false;
			}
		})
		.map(o => ({ name: o, value: o }));
}

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
			.addStringOption(option => option.setName('role').setDescription('Role').setAutocomplete(true).setRequired(true)))
		.addSubcommand(command => command.setName('unsub').setDescription('Unsubscribe from a role')
			.addStringOption(option => option.setName('role').setDescription('Role').setAutocomplete(true).setRequired(true)))
		.addSubcommand(command => command.setName('assign').setDescription('Assign a role to a user')
			.addUserOption(option => option.setName('user').setDescription('User').setRequired(true))
			.addStringOption(option => option.setName('role').setDescription('Role').setAutocomplete(true).setRequired(true)))
		.addSubcommand(command => command.setName('unassign').setDescription('Unassign a role from a user')
			.addUserOption(option => option.setName('user').setDescription('User').setRequired(true))
			.addStringOption(option => option.setName('role').setDescription('Role').setAutocomplete(true).setRequired(true))),
	async autocomplete(interaction, member, perm, permName) {
		const subCommand = interaction.options.getSubcommand();
		const focusedOption = interaction.options.getFocused(true);
		let search = focusedOption.value.toLowerCase();
		switch (subCommand) {
			case 'sub':
			case 'unsub': {
				if (focusedOption.name === 'role') {
					await interaction.respond(sortAndLimitOptions(global.getUserRoles(false, member, subCommand !== 'sub'), 25, search));
					return;
				}
				break;
			}
			case 'assign':
			case 'unassign': {
				let targetMember = interaction.guild.members.resolve(interaction.options.get('user')?.value);
				if (!targetMember)
					return;
				if (focusedOption.name === 'role') {
					await interaction.respond(sortAndLimitOptions(global.getUserRoles(true, targetMember, subCommand !== 'assign'), 25, search));
					return;
				}
				break;
			}
		}
	},
	async execute(interaction, member, perm, permName) {
		const subCommand = interaction.options.getSubcommand();
		switch (subCommand) {
			case 'list': {
				await global.listRoles(interaction, member, interaction.guild, member, false);
				return;
			}
			case 'list_user': {
				if (perm < global.PERM_MOD) {
					await interaction.reply({ content: "You do not have permissions to assign roles", ephemeral: true });
					return;
				}
				let targetMember = interaction.options.getMember('user');
				await global.listRoles(interaction, member, interaction.guild, targetMember, true);
				return;
			}
			case 'members': {
				if (perm < global.PERM_MOD) {
					await interaction.reply({ content: "You do not have permissions to show role members", ephemeral: true });
					return;
				}
				let role = interaction.options.getRole('role');
				await global.listMembers(interaction, member, interaction.guild, role.name);
				return;
			}
			case 'sub':
			case 'unsub': {
				let roleName = interaction.options.getString('role');
				await global.subUnsubRole(interaction, member, interaction.guild, member, false, subCommand === 'sub', roleName);
				return;
			}
			case 'assign':
			case 'unassign': {
				if (perm < global.PERM_MOD) {
					await interaction.reply({ content: "You do not have permissions to assign roles", ephemeral: true });
					return;
				}
				let targetMember = interaction.options.getMember('user');
				let roleName = interaction.options.getString('role');
				await global.subUnsubRole(interaction, targetMember, interaction.guild, targetMember, true, subCommand === 'assign', roleName);
				return;
			}
		}
	}
};
