/* jshint esversion: 11 */

const {
	SlashCommandBuilder,
	PermissionFlagsBits,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle
} = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('roles')
		.setDescription('Manage user roles')
		.addSubcommand(command => command.setName('list').setDescription('Lists your current and available subscribable roles'))
		.addSubcommand(command => command.setName('list-user').setDescription('Lists current and available assignable roles for another user')
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
			.addSubcommand(command => command.setName('add-assignable').setDescription('Add an existing Role as assignable')
				.addStringOption(option => option.setName('role').setDescription('Role').setAutocomplete(true).setRequired(true)))
			.addSubcommand(command => command.setName('add-subscribable').setDescription('Add an existing Role as subscribable')
				.addStringOption(option => option.setName('role').setDescription('Role').setAutocomplete(true).setRequired(true)))
			.addSubcommand(command => command.setName('create-assignable').setDescription('Create a new Role as assignable')
				.addStringOption(option => option.setName('role').setDescription('Role').setRequired(true)))
			.addSubcommand(command => command.setName('create-subscribable').setDescription('Create a new Role as subscribable')
				.addStringOption(option => option.setName('role').setDescription('Role').setRequired(true)))
			.addSubcommand(command => command.setName('remove-assignable').setDescription('Remove an assignable Role')
				.addStringOption(option => option.setName('role').setDescription('Role').setAutocomplete(true).setRequired(true)))
			.addSubcommand(command => command.setName('remove-subscribable').setDescription('Remove a subscribable Role')
				.addStringOption(option => option.setName('role').setDescription('Role').setAutocomplete(true).setRequired(true)))
			.addSubcommand(command => command.setName('rename').setDescription('Rename a managed role')
				.addStringOption(option => option.setName('role').setDescription('Role').setAutocomplete(true).setRequired(true))
				.addStringOption(option => option.setName('name').setDescription('New role name').setRequired(true)))
			.addSubcommand(command => command.setName('list').setDescription('List managed Roles'))
			.addSubcommand(command => command.setName('prune').setDescription('Prune Roles that have been manually removed'))
			.addSubcommand(command => command.setName('button').setDescription('Add a Get Role button to a channel')
				.addStringOption(option => option.setName('role').setDescription('Role').setAutocomplete(true).setRequired(true))
				.addStringOption(option => option.setName('text').setDescription('Descriptive Message'))
				.addStringOption(option => option.setName('emoji').setDescription('Button Emoji'))
				.addChannelOption(option => option.setName('channel').setDescription('Channel to send the button to'))))
		.addSubcommandGroup(command => command.setName('dependencies').setDescription('Manage role dependencies')
			.addSubcommand(command => command.setName('add').setDescription('Add a role dependency')
				.addRoleOption(option => option.setName('dependent-role').setDescription('Dependent Role').setRequired(true))
				.addRoleOption(option => option.setName('required-role').setDescription('Required Role').setRequired(true)))
			.addSubcommand(command => command.setName('delete').setDescription('Delete a role dependency')
				.addRoleOption(option => option.setName('dependent-role').setDescription('Dependent Role').setRequired(true))
				.addRoleOption(option => option.setName('required-role').setDescription('Required Role').setRequired(true)))
			.addSubcommand(command => command.setName('list').setDescription('List Dependent Roles'))
			.addSubcommand(command => command.setName('audit').setDescription('Audit members of Dependent Roles'))
			.addSubcommand(command => command.setName('prune').setDescription('Prune Roles that have been manually removed'))),
	help: true,
	checkPerm(perm, commandName, parentName) {
		if (parentName === 'manage' || parentName === 'dependencies')
			return perm >= global.PERM_STAFF;
		switch (commandName) {
			case 'roles':
			case 'sub':
			case 'unsub':
			case 'list':
				return perm >= global.PERM_NONE;
			case 'assign':
			case 'unassign':
			case 'list-user':
			case 'members':
				return perm >= global.PERM_MOD;
		}
		return false;
	},
	async autocomplete(interaction, guild, member, perm) {
		const subCommand = interaction.options.getSubcommand();
		const focusedOption = interaction.options.getFocused(true);
		let search = focusedOption.value.toLowerCase();
		switch (subCommand) {
			case 'sub':
			case 'unsub': {
				if (focusedOption.name === 'role')
					return interaction.respond(global.sortAndLimitOptions(global.getUserRoles(false, member, subCommand !== 'sub'), 25, search));
				break;
			}
			case 'assign':
			case 'unassign': {
				let targetMember = guild.members.resolve(interaction.options.get('user')?.value);
				if (!targetMember)
					return;
				if (focusedOption.name === 'role')
					return interaction.respond(global.sortAndLimitOptions(global.getUserRoles(true, targetMember, subCommand !== 'assign'), 25, search));
				break;
			}
			case 'add-assignable':
			case 'add-subscribable': {
				if (focusedOption.name === 'role') {
					let managedRoles = global.getUserRoles(subCommand === 'add-assignable');
					let guildRoles = [];
					for (let role of guild.roles.cache.values()) {
						if (managedRoles.includes(role.name) || !global.isManageableRole(role)) {
							continue;
						}
						guildRoles.push(role.name);
					}
					return interaction.respond(global.sortAndLimitOptions(guildRoles, 25, search));
				}
				break;
			}
			case 'remove-assignable':
			case 'remove-subscribable': {
				if (focusedOption.name === 'role') {
					let managedRoles = global.getUserRoles(subCommand === 'remove-assignable');
					return interaction.respond(global.sortAndLimitOptions(managedRoles, 25, search));
				}
				break;
			}
			case 'rename': {
				if (focusedOption.name === 'role') {
					let managedRoles = global.getUserRoles(true).concat(global.getUserRoles(false));
					return interaction.respond(global.sortAndLimitOptions(managedRoles, 25, search));
				}
				break;
			}
			case 'button': {
				if (focusedOption.name === 'role') {
					let managedRoles = global.getUserRoles(false);
					return interaction.respond(global.sortAndLimitOptions(managedRoles, 25, search));
				}
				break;
			}
		}
		return Promise.reject();
	},
	async execute(interaction, guild, member, perm) {
		const subCommand = interaction.options.getSubcommand();
		const commandGroup = interaction.options.getSubcommandGroup(false);
		if (commandGroup === null) {
			switch (subCommand) {
				case 'list': {
					return global.listRoles(interaction, member, guild, member, false);
				}
				case 'list-user': {
					let targetMember = interaction.options.getMember('user');
					return global.listRoles(interaction, member, guild, targetMember, true);
				}
				case 'members': {
					let role = interaction.options.getRole('role');
					return global.listMembers(interaction, member, guild, role.name);
				}
				case 'sub':
				case 'unsub': {
					let roleName = interaction.options.getString('role');
					return global.subUnsubRole(interaction, member, guild, member, false, subCommand === 'sub', roleName);
				}
				case 'assign':
				case 'unassign': {
					let targetMember = interaction.options.getMember('user');
					let roleName = interaction.options.getString('role');
					return global.subUnsubRole(interaction, targetMember, guild, targetMember, true, subCommand === 'assign', roleName);
				}
			}
		} else if (commandGroup === 'manage') {
			await interaction.deferReply({ ephemeral: true });
			switch (subCommand) {
				case 'list': {
					return global.listManagedRoles(interaction, member, guild);
				}
				case 'prune': {
					return global.pruneManagedRoles(interaction, member, guild);
				}
				case 'add-assignable':
				case 'add-subscribable': {
					let roleName = interaction.options.getString('role');
					return global.addManagedRole(interaction, member, guild, roleName, false, subCommand === 'add-assignable');
				}
				case 'create-assignable':
				case 'create-subscribable': {
					let roleName = interaction.options.getString('role');
					return global.addManagedRole(interaction, member, guild, roleName, true, subCommand === 'create-assignable');
				}
				case 'remove-assignable':
				case 'remove-subscribable': {
					let roleName = interaction.options.getString('role');
					return global.removeManagedRole(interaction, member, guild, roleName, subCommand === 'remove-assignable');
				}
				case 'rename': {
					let roleName = interaction.options.getString('role');
					let newRoleName = interaction.options.getString('name');
					return global.renameManagedRole(interaction, member, guild, roleName, newRoleName);
				}
				case 'button': {
					let roleName = interaction.options.getString('role');
					let text = interaction.options.getString('text') ?? '';
					let emoji = interaction.options.getString('emoji') ?? null;
					let channel = interaction.options.getChannel('channel') ?? interaction.channel;
					let role = guild.roles.cache.find(r => { return r.name == roleName; });
					if (!role || !global.isManageableRole(role)) {
						return global.ephemeralReply(interaction, 'Invalid role.');
					}
					let managedRoles = global.getUserRoles(false);
					if (!managedRoles.includes(role.name)) {
						return global.ephemeralReply(interaction, 'Invalid role.');
					}

					if (emoji) {
						emoji = interaction.client.emojis.resolveIdentifier(emoji);
						if (!emoji) {
							return global.ephemeralReply(interaction, 'Invalid emoji.');
						}
					}

					const get_role = new ButtonBuilder()
						.setCustomId(`::roles::get_role::${role.id}`)
						.setLabel(`Get ${roleName} Role`)
						.setStyle(ButtonStyle.Primary);
					const remove_role = new ButtonBuilder()
						.setCustomId(`::roles::remove_role::${role.id}`)
						.setLabel(`Remove ${roleName} Role`)
						.setStyle(ButtonStyle.Secondary);
					if (emoji)
						get_role.setEmoji(emoji);
					const row = new ActionRowBuilder()
						.addComponents(get_role, remove_role);
					return channel.send({
						content: text,
						components: [row]
					});
				}
			}
		} else if (commandGroup === 'dependencies') {
			await interaction.deferReply({ ephemeral: true });
			switch (subCommand) {
				case 'add': {
					let dependentRole = interaction.options.getRole('dependent-role');
					let requiredRole = interaction.options.getRole('required-role');
					if (perm < global.PERM_ADMIN) {
						if (global.getPermissionLevelForRole(dependentRole) > global.PERM_MEMBER) {
							return global.ephemeralReply(interaction, `You do not have permissions to add dependencies to ${dependentRole}`);
						}
					}
					return global.setDependentRole(guild, interaction, dependentRole, requiredRole, false);
				}
				case 'delete': {
					let dependentRole = interaction.options.getRole('dependent-role');
					let requiredRole = interaction.options.getRole('required-role');
					return global.unsetDependentRole(guild, interaction, dependentRole, requiredRole, false);
				}
				case 'list': {
					return global.listDependentRoles(guild, interaction);
				}
				case 'prune': {
					return global.pruneDependentRoles(guild, interaction);
				}
			}
		}
		return Promise.reject();
	},
	async button(interaction, guild, member, perm) {
		let args = interaction.customId.split('::');
		if (args.length < 4) {
			return global.ephemeralReply(interaction, 'Invalid request.');
		}
		let type = args[2];
		let data = args[3];
		let role = guild.roles.resolve(data);
		if (!role || !global.isManageableRole(role)) {
			return global.ephemeralReply(interaction, 'Invalid role.');
		}
		switch (type) {
			case 'get_role': {
				if (member.roles.resolve(data))
					return global.ephemeralReply(interaction, `${role.name} already assigned.`);
				await interaction.deferReply({ ephemeral: true });
				return addRemoveRole(interaction, guild, true, role, member);
			}
			case 'remove_role': {
				if (!member.roles.resolve(data))
					return global.ephemeralReply(interaction, `${role.name} not assigned.`);
				await interaction.deferReply({ ephemeral: true });
				return addRemoveRole(interaction, guild, false, role, member);
			}
			default:
				return global.ephemeralReply(interaction, 'Invalid request.');
		}
		return Promise.reject();
	}
};
