/* jshint esversion: 11 */

const {
	SlashCommandBuilder,
	PermissionFlagsBits
} = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('forumsync')
		.setDescription('Manage forum integration')
		.addSubcommand(command => command.setName('show-map').setDescription('Show the current synchronization map'))
		.addSubcommand(command => command.setName('show-roles').setDescription('Show the roles eligible to be mapped'))
		.addSubcommand(command => command.setName('show-forumgroups').setDescription('Show the forum groups eligible to be mapped'))
		.addSubcommand(command => command.setName('add').setDescription('Map a forum group to a role')
			.addStringOption(option => option.setName('role').setDescription('Role').setRequired(true).setAutocomplete(true))
			.addStringOption(option => option.setName('group').setDescription('Forum Group').setRequired(true).setAutocomplete(true)))
		.addSubcommand(command => command.setName('delete').setDescription('Remove a forum group mapping from a role')
			.addStringOption(option => option.setName('role').setDescription('Role').setRequired(true).setAutocomplete(true))
			.addStringOption(option => option.setName('group').setDescription('Forum Group').setRequired(true).setAutocomplete(true)))
		.addSubcommand(command => command.setName('prune').setDescription('Remove invalid map entries'))
		.addSubcommand(command => command.setName('sync').setDescription('Execute forum sync on demand')),
	help: true,
	checkPerm(perm, commandName, parentName) {
		return perm >= global.PERM_STAFF;
	},
	async autocomplete(interaction, guild, member, perm, permName) {
		const subCommand = interaction.options.getSubcommand();
		const focusedOption = interaction.options.getFocused(true);
		let search = focusedOption.value.toLowerCase();
		switch (subCommand) {
			case 'add':
			case 'delete': {
				if (focusedOption.name === 'role') {
					let roles = guild.roles.cache
						.filter(r => r.name.endsWith(global.config.discordOfficerSuffix))
						.map(r => r.name);
					return interaction.respond(global.sortAndLimitOptions(roles, 25, search)).catch(console.log);
				} else if (focusedOption.name === 'group') {
					let forumGroups = await global.getForumGroups();
					if (forumGroups) {
						forumGroups = Object.values(forumGroups)
							.filter(g => g.endsWith(global.config.forumOfficerSuffix));
						return interaction.respond(global.sortAndLimitOptions(forumGroups, 25, search));
					}
				}
			}
		}
		return Promise.reject();
	},
	async execute(interaction, guild, member, perm, permName) {
		const subCommand = interaction.options.getSubcommand();
		switch (subCommand) {
			case 'show-map': {
				await interaction.deferReply({ ephemeral: true });
				let forumGroups = await global.getForumGroups()
					.catch(console.log);
				var fields = [];
				Object.keys(global.forumIntegrationConfig).forEach(async function(roleName) {
					var groupMap = global.forumIntegrationConfig[roleName];
					fields.push({
						name: roleName + (groupMap.permanent ? ' (permanent)' : ''),
						value: groupMap.forumGroups.map(groupID => `${forumGroups[groupID]} (${groupID})`).join(', ')
					});
					if (fields.length >= 25) {
						await global.ephemeralReply(interaction, { embeds: [{ title: 'Configured Group Maps', fields: fields }] });
						fields = [];
					}
				});

				if (fields.length > 0) {
					await global.ephemeralReply(interaction, { embeds: [{ title: 'Configured Group Maps', fields: fields }] });
				}
				return Promise.resolve();
			}
			case 'show-roles': {
				let embed = {
					title: '',
					fields: [{
						name: 'Discord Officer Roles',
						value: guild.roles.cache
							.filter(r => r.name.endsWith(config.discordOfficerSuffix)).map(r => r.name).sort().join("\n")
					}]
				};
				return global.ephemeralReply(interaction, { embeds: [embed] });
			}
			case 'show-forumgroups': {
				await interaction.deferReply({ ephemeral: true });
				let forumGroups = await global.getForumGroups()
					.catch(console.log);
				var list = Object.keys(forumGroups).map(k => `${forumGroups[k]} (${k})`).sort();
				var i, j, size = 25;
				for (i = 0, j = list.length; i < j; i += size) {
					let chunk = list.slice(i, i + size);
					let embed = {
						title: '',
						fields: [{
							name: 'AOD Forum Groups',
							value: chunk.join("\n")
						}]
					};
					await global.ephemeralReply(interaction, { embeds: [embed] });
				}
				return Promise.resolve();
			}
			case 'sync': {
				await interaction.deferReply({ ephemeral: true });
				return doForumSync(interaction, member, guild, perm, false);
			}
			case 'add':
			case 'delete': {
				let roleName = interaction.options.getString('role');
				let groupName = interaction.options.getString('group');

				if (!roleName.endsWith(global.config.discordOfficerSuffix))
					return global.ephemeralReply(interaction, 'Only Officer Roles may be mapped');
				if (!groupName.endsWith(global.config.forumOfficerSuffix))
					return global.ephemeralReply(interaction, 'Only Officer Groups may be mapped');

				await interaction.deferReply({ ephemeral: true });
				if (subCommand === 'add')
					return global.addForumSyncMap(interaction, guild, roleName, groupName);
				else
					return global.removeForumSyncMap(interaction, guild, roleName, groupName);
				break;
			}
			case 'prune': {
				await interaction.deferReply({ ephemeral: true });
				return pruneForumSyncMap(interaction, guild);
			}
		}
		return Promise.reject();
	},
};
