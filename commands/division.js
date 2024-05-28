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
			.addChannelOption(option => option.setName('channel').setDescription('Channel Name'))),
	help: true,
	checkPerm(perm, commandName) {
		return perm >= global.PERM_STAFF;
	},
	async autocomplete(interaction, member, perm, permName) {
		const subCommand = interaction.options.getSubcommand();
		const focusedOption = interaction.options.getFocused(true);
		let search = focusedOption.value.toLowerCase();
		switch (subCommand) {
			case 'add':
			case 'delete':
			case 'info':
			case 'prefix':
			case 'officer-channel': {
				if (focusedOption.name === 'name') {
					let divisions = await global.getDivisionsFromTracker();
					let options = [];
					for (const divisionName in divisions) {
						if (divisions.hasOwnProperty(divisionName)) {
							if (subCommand === 'info') {
								options.push(divisionName);
							} else if (interaction.guild.channels.cache.find(c => c.name === divisionName && c.type === ChannelType.GuildCategory)) {
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
	async execute(interaction, member, perm, permName) {
		const subCommand = interaction.options.getSubcommand();
		switch (subCommand) {
			case 'add': {
				let name = interaction.options.getString('name');
				await interaction.deferReply({ ephemeral: true });
				return global.addDivision(interaction, member, perm, interaction.guild, name);
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
				const response = await interaction.reply({
					content: `Are you sure you want to delete the ${name} division?`,
					components: [row],
					ephemeral: true
				});

				const filter = (i) => (i.customId === 'confirm_division_delete' || i.customId === 'cancel_division_delete') && i.user.id === interaction.user.id;
				try {
					const confirmation = await response.awaitMessageComponent({ filter: filter, time: 10000 });
					if (confirmation.customId === 'confirm_division_delete') {
						await global.deleteDivision(interaction, member, perm, interaction.guild, name);
						await confirmation.update({
							content: `${name} division deleted`,
							components: []
						}).catch(() => {});
					} else if (confirmation.customId === 'cancel_division_delete') {
						await confirmation.update({
							content: 'Cancelled',
							components: []
						});
					}
				} catch (e) {
					await interaction.editReply({ content: 'Timeout waiting for confirmation', components: [], ephemeral: true });
				}
				return Promise.resolve();
			}
			case 'info': {
				let name = interaction.options.getString('name');

				await interaction.deferReply({ ephemeral: true });
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

				let category = interaction.guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory);
				embed.fields.push({
					name: "Category",
					value: category ? `${category}` : 'Not Found'
				});

				let officer_channel = interaction.guild.channels.resolve(divisionData.officer_channel);
				embed.fields.push({
					name: "Officer Channel",
					value: officer_channel ? `${officer_channel}` : 'Not Found'
				});

				let roleName = name + ' ' + global.config.discordOfficerSuffix;
				let officerRole = interaction.guild.roles.cache.find(r => { return r.name == roleName; });
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

				await interaction.deferReply({ ephemeral: true });
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

				let category = interaction.guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory);
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

				await interaction.deferReply({ ephemeral: true });
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
		}
		return Promise.reject();
	}
};
