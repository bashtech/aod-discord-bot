/* jshint esversion: 11 */

const {
	SlashCommandBuilder,
	PermissionFlagsBits,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle
} = require('discord.js');

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
			.addSubcommand(command => command.setName('prune').setDescription('Prune Roles that have been manually removed'))
			.addSubcommand(command => command.setName('button').setDescription('Add a Get Role button to a channel')
				.addStringOption(option => option.setName('role').setDescription('Role').setAutocomplete(true).setRequired(true))
				.addStringOption(option => option.setName('text').setDescription('Descriptive Message'))
				.addStringOption(option => option.setName('emoji').setDescription('Button Emoji'))
				.addChannelOption(option => option.setName('channel').setDescription('Channel to send the button to')))),
	help: true,
	checkPerm(perm, commandName, parentName) {
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
			case 'button': {
				if (focusedOption.name === 'role') {
					let managedRoles = global.getUserRoles(false);
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
					let targetMember = interaction.options.getMember('user');
					return global.listRoles(interaction, member, interaction.guild, targetMember, true);
				}
				case 'members': {
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
					let targetMember = interaction.options.getMember('user');
					let roleName = interaction.options.getString('role');
					return global.subUnsubRole(interaction, targetMember, interaction.guild, targetMember, true, subCommand === 'assign', roleName);
				}
			}
		} else if (commandGroup === 'manage') {
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
				case 'button': {
					let roleName = interaction.options.getString('role');
					let text = interaction.options.getString('text') ?? '';
					let emoji = interaction.options.getString('emoji') ?? null;
					let channel = interaction.options.getChannel('channel') ?? interaction.channel;
					let role = interaction.guild.roles.cache.find(r => { return r.name == roleName; });
					if (!role || !global.isManageableRole(role)) {
						return interaction.reply({ content: `Invalid role.`, ephemeral: true });
					}
					let managedRoles = global.getUserRoles(false);
					if (!managedRoles.includes(role.name)) {
						return interaction.reply({ content: `Invalid role.`, ephemeral: true });
					}

					if (emoji) {
						emoji = interaction.client.emojis.resolveIdentifier(emoji);
						if (!emoji) {
							return interaction.reply({ content: `Invalid emoji.`, ephemeral: true });
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
					channel.send({
						content: text,
						components: [row]
					});
				}
			}
		}
	},
	async button(interaction, member, perm, permName) {
		let args = interaction.customId.split('::');
		if (args.length < 4) {
			return interaction.reply({ content: `Invalid request.`, ephemeral: true });
		}
		let type = args[2];
		let data = args[3];
		let role = interaction.guild.roles.resolve(data);
		if (!role || !global.isManageableRole(role)) {
			return interaction.reply({ content: `Invalid role.`, ephemeral: true });
		}
		switch (type) {
			case 'get_role': {
				if (member.roles.resolve(data))
					return interaction.reply({ content: `${role.name} already assigned.`, ephemeral: true });
				await interaction.deferReply({ ephemeral: true });
				return addRemoveRole(interaction, interaction.guild, true, role, member);
			}
			case 'remove_role': {
				if (!member.roles.resolve(data))
					return interaction.reply({ content: `${role.name} not assigned.`, ephemeral: true });
				await interaction.deferReply({ ephemeral: true });
				return addRemoveRole(interaction, interaction.guild, false, role, member);
			}
			default:
				return interaction.reply({ content: `Invalid request.`, ephemeral: true });
		}
	}
};
