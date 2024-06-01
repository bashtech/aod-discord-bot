/* jshint esversion: 11 */

const {
	SlashCommandBuilder,
	PermissionFlagsBits,
	ChannelType,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle
} = require('discord.js');

const typeChoices = [
	{ name: 'VAD', value: 'voice' },
	{ name: 'PTT Only', value: 'ptt' },
	{ name: 'JTC', value: 'jtc' },
	{ name: 'Text', value: 'text' },
];

const permChoices = [
	{ name: 'Feed', value: 'feed' },
	{ name: 'Public', value: 'public' },
	{ name: 'Guest+', value: 'guest' },
	{ name: 'Member+', value: 'member' },
	{ name: 'Role Locked', value: 'role' },
	{ name: 'Officer+', value: 'officer' },
	{ name: 'Sgt+', value: 'mod' },
	{ name: 'MSgt+', value: 'staff' },
	{ name: 'Admin Only', value: 'admin' },
];

const voiceTypeChoices = [
	{ name: 'VAD', value: 'voice' },
	{ name: 'PTT Only', value: 'ptt' },
];

module.exports = {
	data: new SlashCommandBuilder()
		.setName('channel')
		.setDescription('Add, remove or update a channel')
		.addSubcommand(command => command.setName('add').setDescription('Create a new channel')
			.addStringOption(option => option.setName('name').setDescription('Channel Name').setRequired(true))
			.addStringOption(option => option.setName('type').setDescription('Channel Type (default=Voice)').setChoices(...typeChoices))
			.addStringOption(option => option.setName('perm').setDescription('Channel Permissions (default=Member)').setChoices(...permChoices))
			.addChannelOption(option => option.setName('category').setDescription('Category for the channel').addChannelTypes(ChannelType.GuildCategory))
			.addStringOption(option => option.setName('role').setDescription('Channel Role for role locked channels').setAutocomplete(true)))
		.addSubcommand(command => command.setName('delete').setDescription('Delete an existing channel')
			.addChannelOption(option => option.setName('channel').setDescription('Channel to delete').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice)))
		.addSubcommand(command => command.setName('topic').setDescription('Set the topic for a channel')
			.addStringOption(option => option.setName('topic').setDescription('Channel Topic (leave empty to clear topic)'))
			.addChannelOption(option => option.setName('channel').setDescription('Channel to update').addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice)))
		.addSubcommand(command => command.setName('update').setDescription('Update the permissions for a channel')
			.addStringOption(option => option.setName('perm').setDescription('Channel Permissions (default=Member)').setRequired(true).setChoices(...permChoices))
			.addChannelOption(option => option.setName('channel').setDescription('Channel to update').addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice))
			.addStringOption(option => option.setName('role').setDescription('Channel Role for role locked channels').setAutocomplete(true))
			.addStringOption(option => option.setName('type').setDescription('Voice Type (ignored for text)').setChoices(...voiceTypeChoices)))
		.addSubcommand(command => command.setName('rename').setDescription('Rename a channel')
			.addChannelOption(option => option.setName('channel').setDescription('Channel to rename').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice))
			.addStringOption(option => option.setName('name').setDescription('Channel Name').setRequired(true)))
		.addSubcommand(command => command.setName('move').setDescription('Move a channel')
			.addChannelOption(option => option.setName('channel').setDescription('Channel to move').setRequired(true)))
		.addSubcommand(command => command.setName('info').setDescription('Channel information')
			.addChannelOption(option => option.setName('channel').setDescription('Channel')))
		.addSubcommand(command => command.setName('purge').setDescription('Purges messages from the current channel')
			.addIntegerOption(option => option.setName('num').setDescription('Number of messages to purge').setRequired(true))),
	help: true,
	checkPerm(perm, commandName, parentName) {
		switch (commandName) {
			case 'channel':
			case 'topic':
				return perm >= global.PERM_MEMBER;
			case 'info':
			case 'add':
				return perm >= global.PERM_RECRUITER;
			case 'delete':
			case 'rename':
			case 'move':
				return perm >= global.PERM_DIVISION_COMMANDER;
			case 'update':
			case 'purge':
				return perm >= global.PERM_STAFF;
		}
		return false;
	},
	async autocomplete(interaction, guild, member, perm, permName) {
		const subCommand = interaction.options.getSubcommand();
		const focusedOption = interaction.options.getFocused(true);
		let search = focusedOption.value.toLowerCase();
		switch (subCommand) {
			case 'add':
			case 'update': {
				if (focusedOption.name === 'role') {
					return interaction.respond(global.sortAndLimitOptions(global.getUserRoles(false, null).concat(global.getUserRoles(true, null)), 25, search));
				}
				break;
			}
		}
		return Promise.reject();
	},
	async execute(interaction, guild, member, perm, permName) {
		const subCommand = interaction.options.getSubcommand();
		switch (subCommand) {
			case 'add': {
				let name = interaction.options.getString('name').toLowerCase().replace(/\s/g, '-');
				let type = interaction.options.getString('type') ?? 'voice';
				let level = interaction.options.getString('perm') ?? 'member';
				let category = interaction.options.getChannel('category');
				let roleName = interaction.options.getString('role');

				let officerRole;
				if (category) {
					//check if this category has an associated officer role
					let officerRoleName = category.name + ' ' + global.config.discordOfficerSuffix;
					officerRole = guild.roles.cache.find(r => { return r.name == officerRoleName; });
					if (perm < global.PERM_DIVISION_COMMANDER)
						return interaction.reply({ content: "You do not have permissions to create permanent channels", ephemeral: true });
					if (perm == global.PERM_DIVISION_COMMANDER && (!officerRole || !member.roles.cache.get(officerRole.id)))
						return interaction.reply({ content: "You can only add channels to a division you command", ephemeral: true });
					if (perm < global.PERM_STAFF && category.children.size >= config.maxChannelsPerCategory)
						return interaction.reply({ content: "Category is full", ephemeral: true });

					let prefix;
					let divisions = await global.getDivisionsFromTracker();
					let divisionData = divisions[category.name];
					if (typeof(divisionData) !== 'undefined') {
						prefix = divisionData.abbreviation;
					} else {
						prefix = category.name.toLowerCase().replace(/\s/g, '-');
					}
					if (name.indexOf(prefix) < 0)
						name = prefix + '-' + name;
				} else {
					if (type === 'text')
						return interaction.reply({ content: "A category must be set for text channels", ephemeral: true });
					if (type === 'jtc')
						return interaction.reply({ content: "A category must be set for join-to-create channels", ephemeral: true });

					category = guild.channels.cache.find(c => { return c.name == config.tempChannelCategory; });
					if (!category)
						return interaction.reply({ content: "Temp channel category not found", ephemeral: true });
				}

				let role;
				if (roleName)
					role = guild.roles.cache.find(r => { return r.name == roleName; });
				if (role) {
					if (level !== 'role')
						return interaction.reply({ content: "Channel Permissions must be 'role' if a Role is selected", ephemeral: true });
					if (perm < global.PERM_DIVISION_COMMANDER)
						return interaction.reply({ content: "You do not have permissions to create role locked channels", ephemeral: true });
				} else if (level === 'role') {
					return interaction.reply({ content: "Role must be provided if Channel Permissions is 'role'", ephemeral: true });
				}

				let existingChannel = guild.channels.cache.find(c => { return c.name == name; });
				if (existingChannel)
					return interaction.reply({ content: "Channel already exists", ephemeral: true });

				await interaction.deferReply({ ephemeral: true });
				return global.addChannel(guild, interaction, member, perm, name, type, level, category, officerRole, role);
			}
			case 'delete': {
				let channel = interaction.options.getChannel('channel');
				let channelName = channel.name;
				if (global.config.protectedChannels.includes(channelName))
					return interaction.reply({ content: `${channel} is a protected channel.`, ephemeral: true });

				let category = channel.parent;
				if (category) {
					//check if this category has an associated officer role
					let officerRoleName = category.name + ' ' + global.config.discordOfficerSuffix;
					let officerRole = guild.roles.cache.find(r => { return r.name == officerRoleName; });
					if (perm == global.PERM_DIVISION_COMMANDER && (!officerRole || !member.roles.cache.get(officerRole.id)))
						return interaction.reply({ content: 'You can only delete channels from a division you command', ephemeral: true });
				} else {
					if (perm < PERM_STAFF)
						return interaction.reply({ content: 'You cannot delete this channel', ephemeral: true });
				}

				const confirm = new ButtonBuilder()
					.setCustomId('confirm_channel_delete')
					.setLabel('Confirm Delete')
					.setStyle(ButtonStyle.Danger);
				const cancel = new ButtonBuilder()
					.setCustomId('cancel_channel_delete')
					.setLabel('Cancel')
					.setStyle(ButtonStyle.Secondary);
				const row = new ActionRowBuilder()
					.addComponents(cancel, confirm);
				const response = await interaction.reply({
					content: `Are you sure you want to delete ${channel}?`,
					components: [row],
					ephemeral: true
				});

				const filter = (i) => (i.customId === 'confirm_channel_delete' || i.customId === 'cancel_channel_delete') && i.user.id === interaction.user.id;
				try {
					const confirmation = await response.awaitMessageComponent({ filter: filter, time: 10000 });
					if (confirmation.customId === 'confirm_channel_delete') {
						await channel.delete(`Requested by ${global.getNameFromMessage(interaction)}`);
						if (interaction.channel.id !== channel.id) {
							await confirmation.update({
								content: `Channel #${channelName} deleted`,
								components: []
							});
						}
					} else if (confirmation.customId === 'cancel_channel_delete') {
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
			case 'topic': {
				let topic = interaction.options.getString('topic') ?? "";
				let channel = interaction.options.getChannel('channel') ?? interaction.channel;
				if (!channel)
					return interaction.reply({ content: "Please provide a channel or execute in a text channel", ephemeral: true });
				if (perm < global.PERM_MOD) {
					let category = channel.parent;
					if (category) {
						let officerRoleName = category.name + ' ' + global.config.discordOfficerSuffix;
						let officerRole = guild.roles.cache.find(r => { return r.name == officerRoleName; });
						if (!officerRole || !member.roles.cache.get(officerRole.id)) {
							if (global.tempChannelCreatedBy(channel.id) !== member.id) {
								return interaction.reply({ content: "You do not have permissions to edit this channel.", ephemeral: true });
							}
						}
					} else {
						return interaction.reply({ content: "You do not have permissions to edit this channel.", ephemeral: true });
					}
				}

				await interaction.deferReply({ ephemeral: true });
				if (channel.type === ChannelType.GuildText) {
					return channel.setTopic(topic, `Requested by ${global.getNameFromMessage(interaction)}`);
				} else if (channel.type === ChannelType.GuildVoice) {
					//return interaction.editReply({ content: "Not supported.", ephemeral: true });
					return interaction.client.rest.put(`/channels/${channel.id}/voice-status`, {
						body: {
							status: topic,
							reason: `Requested by ${global.getNameFromMessage(interaction)}`
						}
					});
				}
				break;
			}
			case 'update': {
				let level = interaction.options.getString('perm') ?? 'member';
				let type = interaction.options.getString('type') ?? null;
				let roleName = interaction.options.getString('role');
				let channel = interaction.options.getChannel('channel') ?? interaction.channel;
				let channelName = channel.name;
				if (global.config.protectedChannels.includes(channelName))
					return interaction.reply({ content: `${channel} is a protected channel`, ephemeral: true });

				let category = channel.parent;
				let officerRole;
				if (category) {
					//check if this category has an associated officer role
					let officerRoleName = category.name + ' ' + global.config.discordOfficerSuffix;
					officerRole = guild.roles.cache.find(r => { return r.name == officerRoleName; });
					if (perm == global.PERM_DIVISION_COMMANDER && (!officerRole || !member.roles.cache.get(officerRole.id)))
						return interaction.reply({ content: 'You can only update channels from a division you command', ephemeral: true });
				} else {
					if (perm < PERM_STAFF)
						return interaction.reply({ content: 'You cannot update this channel', ephemeral: true });
				}

				let role;
				if (roleName)
					role = guild.roles.cache.find(r => { return r.name == roleName; });
				if (role) {
					if (level !== 'role')
						return interaction.reply({ content: "Channel Permissions must be 'role' if a Role is selected", ephemeral: true });
					if (perm < global.PERM_DIVISION_COMMANDER)
						return interaction.reply({ content: "You do not have permissions to create role locked channels", ephemeral: true });
				} else if (level === 'role') {
					return interaction.reply({ content: "Role must be provided if Channel Permissions is 'role'", ephemeral: true });
				}
				await interaction.deferReply({ ephemeral: true });
				return global.setChannelPerms(guild, interaction, member, perm, channel, type, level, category, officerRole, role);
			}
			case 'rename': {
				let name = interaction.options.getString('name').toLowerCase().replace(/\s/g, '-');
				let channel = interaction.options.getChannel('channel') ?? interaction.channel;
				let channelName = channel.name;
				if (channel.type === ChannelType.GuildCategory)
					return interaction.reply({ content: `Cannot rename a category`, ephemeral: true });
				if (global.config.protectedChannels.includes(channelName))
					return interaction.reply({ content: `${channel} is a protected channel`, ephemeral: true });

				let category = channel.parent;
				if (category) {
					//check if this category has an associated officer role
					let officerRoleName = category.name + ' ' + global.config.discordOfficerSuffix;
					let officerRole = guild.roles.cache.find(r => { return r.name == officerRoleName; });
					if (perm == global.PERM_DIVISION_COMMANDER && (!officerRole || !member.roles.cache.get(officerRole.id)))
						return interaction.reply({ content: 'You can only rename channels from a division you command', ephemeral: true });

					let prefix;
					let divisions = await global.getDivisionsFromTracker();
					let divisionData = divisions[category.name];
					if (typeof(divisionData) !== 'undefined') {
						prefix = divisionData.abbreviation;
					} else {
						prefix = category.name.toLowerCase().replace(/\s/g, '-');
					}
					if (!name.startsWith(prefix))
						name = prefix + '-' + name;
				} else {
					if (perm < PERM_STAFF)
						return interaction.reply({ content: 'You cannot rename this channel', ephemeral: true });
				}

				let existingChannel = guild.channels.cache.find(c => { return c.name == name; });
				if (existingChannel)
					return interaction.reply({ content: `A channel already exists with the name ${existingChannel}`, ephemeral: true });

				await interaction.deferReply({ ephemeral: true });
				await channel.setName(name, `Requested by ${global.getNameFromMessage(interaction)}`);
				return interaction.editReply({ content: `#${channelName} renamed to ${channel}`, ephemeral: true });
			}
			case 'move': {
				let channel = interaction.options.getChannel('channel') ?? interaction.channel;
				let category = channel.parent;
				if (category) {
					//check if this category has an associated officer role
					let officerRoleName = category.name + ' ' + global.config.discordOfficerSuffix;
					let officerRole = guild.roles.cache.find(r => { return r.name == officerRoleName; });
					if (perm == global.PERM_DIVISION_COMMANDER && (!officerRole || !member.roles.cache.get(officerRole.id)))
						return interaction.reply({ content: 'You can only move channels in a division you command', ephemeral: true });
					let divisionPrefix = category.name.toLowerCase().replace(/\s/g, '-');
				} else {
					if (perm < PERM_STAFF)
						return interaction.reply({ content: 'You cannot rename this channel', ephemeral: true });
				}

				const up = new ButtonBuilder()
					.setCustomId('move_channel_up')
					.setLabel('Up')
					.setStyle(ButtonStyle.Success);
				const down = new ButtonBuilder()
					.setCustomId('move_channel_down')
					.setLabel('Down')
					.setStyle(ButtonStyle.Primary);
				const done = new ButtonBuilder()
					.setCustomId('move_channel_done')
					.setLabel('Done')
					.setStyle(ButtonStyle.Secondary);
				const row = new ActionRowBuilder()
					.addComponents(up, down, done);
				const response = await interaction.reply({
					content: `Move ${channel}...`,
					components: [row],
					ephemeral: true
				});

				const filter = (i) =>
					(i.customId === 'move_channel_up' ||
						i.customId === 'move_channel_down' ||
						i.customId === 'move_channel_done') &&
					i.user.id === interaction.user.id;
				while (1) {
					try {
						const action = await response.awaitMessageComponent({ filter: filter, time: 30000 });
						if (action.customId === 'move_channel_up') {
							await channel.setPosition(-1, { relative: true, reason: `Requested by ${global.getNameFromMessage(interaction)}` });
						} else if (action.customId === 'move_channel_down') {
							await channel.setPosition(1, { relative: true, reason: `Requested by ${global.getNameFromMessage(interaction)}` });
						} else {
							return interaction.editReply({ content: 'Done', components: [], ephemeral: true });
						}
						await action.update({
							content: `Move ${channel}...`,
							components: [row],
							ephemeral: true
						});
					} catch (e) {
						return await interaction.editReply({ content: 'Timeout', components: [], ephemeral: true });
					}
				}
				return Promise.resolve();
			}
			case 'info': {
				let channel = interaction.options.getChannel('channel') ?? interaction.channel;
				let officerRole;
				let category = channel.parent;
				if (category) {
					//check if this category has an associated officer role
					let officerRoleName = category.name + ' ' + global.config.discordOfficerSuffix;
					officerRole = guild.roles.cache.find(r => { return r.name == officerRoleName; });
				}

				await interaction.deferReply({ ephemeral: true });
				info = await global.getChannelInfo(guild, channel, officerRole);

				let embed = {
					description: `**Information for ${channel}**`,
					fields: [{
						name: 'Channel Type',
						value: info.type
					}, {
						name: 'Permission Level',
						value: info.perm
					}],
				};

				if (officerRole) {
					embed.fields.push({
						name: 'Officer Role',
						value: `${officerRole}`
					});
				}

				if (info.details.role) {
					embed.fields.push({
						name: 'Channel Role',
						value: `${info.details.role.role}`
					});
				}

				return global.ephemeralReply(interaction, embed);
			}
			case 'purge': {
				let deleteCount = interaction.options.getInteger('num');

				if (deleteCount < 1 || deleteCount > 100)
					return global.ephemeralReply(interaction, "Please provide a number between 1 and 100 for the number of messages to delete");

				await interaction.deferReply({ ephemeral: true });
				try {
					let fetched = await interaction.channel.messages.fetch({ limit: deleteCount });
					await interaction.channel.bulkDelete(fetched);

					return global.ephemeralReply(interaction, `Purged ${fetched.size} message(s) from the channel`);
				} catch (error) {
					console.error(error);
					return global.ephemeralReply(interaction, 'An error occurred purging messages');
				}
				break;
			}
		}
		return Promise.reject();
	}
};
