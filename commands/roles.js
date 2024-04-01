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
		.setDescription('Manage user roles')
		.addSubcommand(command => command.setName('list').setDescription('Lists your current and available subscribable roles'))
		.addSubcommand(command => command.setName('list_user').setDescription('Lists current and available assignable roles for another user')
			.addUserOption(option => option.setName('user').setDescription('User').setRequired(true)))
		.addSubcommand(command => command.setName('members').setDescription('Show members of a role')
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
			.addStringOption(option => option.setName('role').setDescription('Role').setAutocomplete(true).setRequired(true)))
		.addSubcommandGroup(command => command.setName('manage').setDescription('Manage Roles')
			.addSubcommand(command => command.setName('add_assignable').setDescription('Add an existing Role as assignable')
				.addStringOption(option => option.setName('role').setDescription('Role').setAutocomplete(true).setRequired(true)))
			.addSubcommand(command => command.setName('add_subscribable').setDescription('Add an existing Role as subscribable')
				.addStringOption(option => option.setName('role').setDescription('Role').setAutocomplete(true).setRequired(true)))
			.addSubcommand(command => command.setName('create_assignable').setDescription('Create a new Role as assignable')
				.addStringOption(option => option.setName('role').setDescription('Role').setRequired(true)))
			.addSubcommand(command => command.setName('create_subscribable').setDescription('Create a new Role as subscribable')
				.addStringOption(option => option.setName('role').setDescription('Role').setRequired(true)))
			.addSubcommand(command => command.setName('remove_assignable').setDescription('Remove an assignable Role')
				.addStringOption(option => option.setName('role').setDescription('Role').setAutocomplete(true).setRequired(true)))
			.addSubcommand(command => command.setName('remove_subscribable').setDescription('Remove a subscribable Role')
				.addStringOption(option => option.setName('role').setDescription('Role').setAutocomplete(true).setRequired(true)))
			.addSubcommand(command => command.setName('list').setDescription('List managed Roles'))
			.addSubcommand(command => command.setName('prune').setDescription('Prune Roles that have been manually removed'))),
	help: true,
	checkPerm(commandName, perm, parentName) {
		if (parentName === 'manage')
			return perm >= global.PERM_STAFF;
		switch (commandName) {
			case 'roles':
			case 'sub':
			case 'unsub':
			case 'list':
				return perm >= global.PERM_NONE;
			case 'assign':
			case 'unassign':
			case 'list_user':
			case 'members':
				return perm >= global.PERM_MOD;
		}
		return false;
	},
	async autocomplete(interaction, member, perm, permName) {
		const subCommand = interaction.options.getSubcommand();
		const focusedOption = interaction.options.getFocused(true);
		let search = focusedOption.value.toLowerCase();
		switch (subCommand) {
			case 'sub':
			case 'unsub': {
				if (focusedOption.name === 'role')
					return interaction.respond(sortAndLimitOptions(global.getUserRoles(false, member, subCommand !== 'sub'), 25, search));
				break;
			}
			case 'assign':
			case 'unassign': {
				let targetMember = interaction.guild.members.resolve(interaction.options.get('user')?.value);
				if (!targetMember)
					return;
				if (focusedOption.name === 'role')
					return interaction.respond(sortAndLimitOptions(global.getUserRoles(true, targetMember, subCommand !== 'assign'), 25, search));
				break;
			}
			case 'add_assignable':
			case 'add_subscribable': {
				if (focusedOption.name === 'role') {
					let managedRoles = global.getUserRoles(subCommand === 'add_assignable');
					let guildRoles = [];
					for (let role of interaction.guild.roles.cache.values()) {
						if (managedRoles.includes(role.name) || !global.isManageableRole(role)) {
							continue;
						}
						guildRoles.push(role.name);
					}
					return interaction.respond(sortAndLimitOptions(guildRoles, 25, search));
				}
				break;
			}
			case 'remove_assignable':
			case 'remove_subscribable': {
				if (focusedOption.name === 'role') {
					let managedRoles = global.getUserRoles(subCommand === 'remove_assignable');
					return interaction.respond(sortAndLimitOptions(managedRoles, 25, search));
				}
				break;
			}
		}
	},
	async execute(interaction, member, perm, permName) {
		const subCommand = interaction.options.getSubcommand();
		const commandGroup = interaction.options.getSubcommandGroup(false);
		if (commandGroup === null) {
			switch (subCommand) {
				case 'list': {
					return global.listRoles(interaction, member, interaction.guild, member, false);
				}
				case 'list_user': {
					if (perm < global.PERM_MOD)
						return interaction.reply({ content: "You do not have permissions to assign roles", ephemeral: true });
					let targetMember = interaction.options.getMember('user');
					return global.listRoles(interaction, member, interaction.guild, targetMember, true);
				}
				case 'members': {
					if (perm < global.PERM_MOD)
						return interaction.reply({ content: "You do not have permissions to show role members", ephemeral: true });
					let role = interaction.options.getRole('role');
					return global.listMembers(interaction, member, interaction.guild, role.name);
				}
				case 'sub':
				case 'unsub': {
					let roleName = interaction.options.getString('role');
					return global.subUnsubRole(interaction, member, interaction.guild, member, false, subCommand === 'sub', roleName);
				}
				case 'assign':
				case 'unassign': {
					if (perm < global.PERM_MOD)
						return interaction.reply({ content: "You do not have permissions to assign roles", ephemeral: true });
					let targetMember = interaction.options.getMember('user');
					let roleName = interaction.options.getString('role');
					return global.subUnsubRole(interaction, targetMember, interaction.guild, targetMember, true, subCommand === 'assign', roleName);
				}
			}
		} else if (commandGroup === 'manage') {
			if (perm < global.PERM_STAFF)
				return interaction.reply({ content: "You do not have permissions to change managed roles", ephemeral: true });
			await interaction.deferReply({ ephemeral: true });
			switch (subCommand) {
				case 'list': {
					return global.listManagedRoles(interaction, member, interaction.guild);
				}
				case 'prune': {
					return global.pruneManagedRoles(interaction, member, interaction.guild);
				}
				case 'add_assignable':
				case 'add_subscribable': {
					let roleName = interaction.options.getString('role');
					return global.addManagedRole(interaction, member, interaction.guild, roleName, false, subCommand === 'add_assignable');
				}
				case 'create_assignable':
				case 'create_subscribable': {
					let roleName = interaction.options.getString('role');
					return global.addManagedRole(interaction, member, interaction.guild, roleName, true, subCommand === 'create_assignable');
				}
				case 'remove_assignable':
				case 'remove_subscribable': {
					let roleName = interaction.options.getString('role');
					return global.removeManagedRole(interaction, member, interaction.guild, roleName, subCommand === 'remove_assignable');
				}
			}
		}
	}
};
