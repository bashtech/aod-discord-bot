/* jshint esversion: 11 */

const {
	SlashCommandBuilder,
	PermissionFlagsBits,
	ChannelType,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle
} = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('division')
		.setDescription('Add, remove or update a division')
		.addSubcommand(command => command.setName('add').setDescription('Create a new division')
			.addStringOption(option => option.setName('name').setDescription('Division Name').setAutocomplete(true).setRequired(true)))
		.addSubcommand(command => command.setName('delete').setDescription('Delete an exiting division')
			.addStringOption(option => option.setName('name').setDescription('Division Name').setAutocomplete(true).setRequired(true)))
		.addSubcommand(command => command.setName('info').setDescription('Show division information')
			.addStringOption(option => option.setName('name').setDescription('Division Name').setAutocomplete(true).setRequired(true)))
		.addSubcommand(command => command.setName('prefix').setDescription('Update division channel prefix')
			.addStringOption(option => option.setName('name').setDescription('Division Name').setAutocomplete(true).setRequired(true))
			.addStringOption(option => option.setName('old-prefix').setDescription('Old Prefix (if not the division name)'))
			.addStringOption(option => option.setName('new-prefix').setDescription('New Prefix (if division name does not match tracker)')))
		.addSubcommand(command => command.setName('officer-channel').setDescription('Update division channel prefix')
			.addStringOption(option => option.setName('name').setDescription('Division Name').setAutocomplete(true).setRequired(true))
			.addChannelOption(option => option.setName('channel').setDescription('Channel Name')))
		.addSubcommand(command => command.setName('convert').setDescription('Convert Division Permissions')
			.addStringOption(option => option.setName('name').setDescription('Division Name').setAutocomplete(true).setRequired(true))
			.addBooleanOption(option => option.setName('test').setDescription('Test only').setRequired(true)))
		.addSubcommand(command => command.setName('update-onboarding').setDescription('Update onboarding')),
	help: true,
	checkPerm(perm, commandName) {
		return perm >= global.PERM_STAFF;
	},
	async autocomplete(interaction, guild, member, perm) {
		const subCommand = interaction.options.getSubcommand();
		const focusedOption = interaction.options.getFocused(true);
		let search = focusedOption.value.toLowerCase();
		switch (subCommand) {
			case 'add':
			case 'delete':
			case 'info':
			case 'prefix':
			case 'officer-channel':
			case 'convert': {
				if (focusedOption.name === 'name') {
					let divisions = await global.getDivisionsFromTracker();
					let options = [];
					for (const divisionName in divisions) {
						if (divisions.hasOwnProperty(divisionName)) {
							if (subCommand === 'info' || subCommand === 'convert') {
								options.push(divisionName);
							} else if (guild.channels.cache.find(c => c.name === divisionName && c.type === ChannelType.GuildCategory)) {
								if (subCommand === 'delete' || subCommand === 'prefix' || subCommand === 'officer-channel') {
									options.push(divisionName);
								}
							} else {
								if (subCommand === 'add') {
									options.push(divisionName);
								}
							}
						}
					}
					return interaction.respond(global.sortAndLimitOptions(options, 25, search));
				}
				break;
			}
		}
		return Promise.reject();
	},
	async execute(interaction, guild, member, perm) {
		const subCommand = interaction.options.getSubcommand();
		await interaction.deferReply({ ephemeral: true });
		switch (subCommand) {
			case 'add': {
				let name = interaction.options.getString('name');
				return global.addDivision(interaction, member, perm, guild, name);
			}
			case 'delete': {
				let name = interaction.options.getString('name');

				const confirm = new ButtonBuilder()
					.setCustomId('confirm_division_delete')
					.setLabel('Confirm Delete')
					.setStyle(ButtonStyle.Danger);
				const cancel = new ButtonBuilder()
					.setCustomId('cancel_division_delete')
					.setLabel('Cancel')
					.setStyle(ButtonStyle.Secondary);
				const row = new ActionRowBuilder()
					.addComponents(cancel, confirm);
				const response = await interaction.editReply({
					content: `Are you sure you want to delete the ${name} division?`,
					components: [row],
					ephemeral: true
				});

				const filter = (i) => (i.customId === 'confirm_division_delete' || i.customId === 'cancel_division_delete') && i.user.id === interaction.user.id;
				try {
					const confirmation = await response.awaitMessageComponent({ filter: filter, time: 10000 });
					if (confirmation.customId === 'confirm_division_delete') {
						await confirmation.update({
							content: `Deleting ${name} division...`,
							components: []
						}).catch(() => {});
						await global.deleteDivision(interaction, member, perm, guild, name);
						await interaction.followUp({
							content: `${name} division deleted`,
							components: [],
							ephemeral: true
						}).catch(() => {});
					} else if (confirmation.customId === 'cancel_division_delete') {
						await confirmation.update({
							content: 'Cancelled',
							components: []
						});
					}
				} catch (e) {
					if (!e.code || e.code !== 'InteractionCollectorError') {
						console.log(e);
						await interaction.editReply({ components: [], ephemeral: true });
						await global.ephemeralReply(interaction, `An error occured while deleting the ${name} division`);
					} else {
						await interaction.editReply({ content: 'Timeout waiting for confirmation', components: [], ephemeral: true });
					}
				}
				return Promise.resolve();
			}
			case 'info': {
				let name = interaction.options.getString('name');
				let divisions = await global.getDivisionsFromTracker();
				let divisionData = divisions[name];
				if (typeof(divisionData) === 'undefined') {
					return global.ephemeralReply(interaction, `${name} division is not defined on the tracker`);
				}

				let embed = {
					description: `**${name} Division Information**`,
					thumbnail: { url: divisionData ? divisionData.icon : "" },
					fields: []
				};

				let category = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory);
				embed.fields.push({
					name: "Category",
					value: category ? `${category}` : 'Not Found'
				});

				let officer_channel = guild.channels.resolve(divisionData.officer_channel);
				embed.fields.push({
					name: "Officer Channel",
					value: officer_channel ? `${officer_channel}` : 'Not Found'
				});

				let roleName = name + ' ' + global.config.discordOfficerSuffix;
				let officerRole = guild.roles.cache.find(r => { return r.name == roleName; });
				if (officerRole) {
					let officers = '';
					officerRole.members.each(m => {
						officers += `${m}\n`;
					});
					embed.fields.push({
						name: "Officers",
						value: officers
					});
				}
				return global.ephemeralReply(interaction, embed);
			}
			case 'prefix': {
				let name = interaction.options.getString('name');
				let old_prefix = interaction.options.getString('old-prefix');
				let new_prefix = interaction.options.getString('new-prefix');

				if (global.config.protectedCategories.includes(name)) {
					return global.ephemeralReply(interaction, `${name} is a protected category`);
				}

				let divisions = await global.getDivisionsFromTracker();
				let divisionData = divisions[name];
				if (typeof(divisionData) !== 'undefined') {
					if (new_prefix && new_prefix !== divisionData.abbreviation)
						return global.ephemeralReply(interaction, 'new_prefix must be the configured abbreviation for the division');
					new_prefix = divisionData.abbreviation;
					if (!old_prefix) {
						let lcName = name.toLowerCase();
						old_prefix = lcName.replace(/\s/g, '-');
					}
				} else {
					if (!new_prefix)
						return global.ephemeralReply(interaction, 'new_prefix must be set if the division is configured on the tracker');
					if (!old_prefix)
						return global.ephemeralReply(interaction, 'old_prefix must be set if the division is configured on the tracker');
				}

				let category = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory);
				if (!category) {
					return global.ephemeralReply(interaction, `No category for ${name} found`);
				}

				let reply = '';
				for (let c of category.children.cache.values()) {
					if (c.name.startsWith(old_prefix)) {
						let new_name = c.name.replace(old_prefix, new_prefix);
						reply += `${c.name} renamed to ${new_name}\n`;
						await c.setName(new_name);
					} else {
						reply += `${c.name} does not match ${old_prefix}\n`;
					}
				}
				return global.ephemeralReply(interaction, reply);
			}
			case 'officer-channel': {
				let name = interaction.options.getString('name');
				let channel = interaction.options.getChannel('channel') ?? interaction.channel;

				let divisions = await global.getDivisionsFromTracker();
				let divisionData = divisions[name];
				if (typeof(divisionData) === 'undefined') {
					return global.ephemeralReply(interaction, `${name} division is not defined on the tracker`);
				}
				if (!channel.parent || channel.parent.name !== name) {
					return global.ephemeralReply(interaction, `Officer Channel must be a channel in the division category`);
				}

				return global.updateTrackerDivisionOfficerChannel(divisionData, channel);
			}
			case 'update-onboarding': {
				return global.updateOnboarding(guild, interaction);
			}
			case 'convert': {
				let name = interaction.options.getString('name');
				let test = interaction.options.getBoolean('test');

				let divisions = await global.getDivisionsFromTracker();
				let divisionData = divisions[name];
				if (typeof(divisionData) === 'undefined') {
					return global.ephemeralReply(interaction, `${name} division is not defined on the tracker`);
				}

				let category = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory);
				if (!category) {
					return global.ephemeralReply(interaction, `No category for ${name} found`);
				}
				interaction.replied = true;

				const memberRole = guild.roles.cache.find(r => { return r.name == config.memberRole; });
				const guestRole = guild.roles.cache.find(r => { return r.name == config.guestRole; });

				let officerRoleName = category.name + ' ' + global.config.discordOfficerSuffix;
				let divisionOfficerRole = guild.roles.cache.find(r => { return r.name == officerRoleName; });
				if (!divisionOfficerRole) {
					await global.ephemeralReply(interaction, `Add division officer role: ${officerRoleName}`, false);
					if (!test) {
						divisionOfficerRole = await guild.roles.create({
							name: officerRoleName,
							permissions: [],
							mentionable: true,
							reason: `Requested by ${getNameFromMessage(interaction)}`
						});
						await divisionOfficerRole.setPosition(memberRole.position + 1).catch(console.log);
					}
				}

				let memberRoleName = category.name + ' ' + global.config.discordMemberSuffix;
				let divisionMemberRole = guild.roles.cache.find(r => { return r.name == memberRoleName; });
				if (!divisionMemberRole) {
					await global.ephemeralReply(interaction, `Add division member role: ${memberRoleName}`, false);
					if (!test) {
						divisionMemberRole = await guild.roles.create({
							name: memberRoleName,
							permissions: [],
							mentionable: true,
							reason: `Requested by ${getNameFromMessage(interaction)}`
						});
						await divisionMemberRole.setPosition(memberRole.position - 1).catch(console.log);
					}
				}

				let divisionRoleName = category.name;
				let divisionRole = guild.roles.cache.find(r => { return r.name == divisionRoleName; });
				if (!divisionRole) {
					await global.ephemeralReply(interaction, `Add division role: ${divisionRoleName}`, false);
					if (!test) {
						divisionRole = await guild.roles.create({
							name: divisionRoleName,
							permissions: [],
							mentionable: true,
							reason: `Requested by ${getNameFromMessage(interaction)}`
						});
						await divisionRole.setPosition(guestRole.position - 1).catch(console.log);

						await setDependentRole(guild, interaction, divisionMemberRole, memberRole, false);
						await setDependentRole(guild, interaction, divisionMemberRole, divisionRole, false);
						await addManagedRole(interaction, member, guild, divisionRoleName, false, false);
						await addManagedRole(interaction, member, guild, divisionRoleName, false, true);
					}
				}

				for (const [channelName, c] of category.children.cache) {
					let info = await global.getChannelInfo(guild, c);
					switch (info.perm) {
						case 'public':
						case 'guest': {
							await global.ephemeralReply(interaction, `Convert ${c} to role locked channel, role: ${divisionRoleName}`, false);
							if (!test) {
								await global.setChannelPerms(guild, interaction, member, perm, c, null, 'role', category, divisionOfficerRole, divisionRole);
							}
							break;
						}
						case 'feed': {
							await global.ephemeralReply(interaction, `Convert ${c} to role locked feed channel, role: ${divisionRoleName}`, false);
							if (!test) {
								await global.setChannelPerms(guild, interaction, member, perm, c, null, 'role-feed', category, divisionOfficerRole, divisionRole);
							}
							break;
						}
						case 'member': {
							await global.ephemeralReply(interaction, `Convert ${c} to role locked channel, role: ${memberRoleName}`, false);
							if (!test) {
								await global.setChannelPerms(guild, interaction, member, perm, c, null, 'role', category, divisionOfficerRole, divisionMemberRole);
							}
							break;
						}
					}
				}

				return global.ephemeralReply(interaction, `Conversion for ${name} complete`, false);
			}
		}
		return Promise.reject();
	}
};
