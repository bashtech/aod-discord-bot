/* jshint esversion: 8 */

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType,
			ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const typeChoices = [
	{ name: 'Voice Channel', value: 'voice' },
	{ name: 'PTT Voice Channel', value: 'ptt' },
	{ name: 'Text', value: 'text' },
];

const permChoices = [
	{ name: 'Feed', value: 'feed' },
	{ name: 'Guest+', value: 'guest' },
	{ name: 'Member+', value: 'member' },
	{ name: 'Role Locked', value: 'role' },
	{ name: 'Officer+', value: 'officer' },
	{ name: 'Sgt+', value: 'mod' },
	{ name: 'MSgt+', value: 'staff' },
	{ name: 'Admin Only', value: 'admin' },
];

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
		.setName('channel')
		.setDescription('Add, remove or alter a channel')
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
			.addStringOption(option => option.setName('role').setDescription('Channel Role for role locked channels').setAutocomplete(true))),
	async autocomplete(interaction, member, perm, permName) {
		const subCommand = interaction.options.getSubcommand();
		const focusedOption = interaction.options.getFocused(true);
		let search = focusedOption.value.toLowerCase();
		switch (subCommand) {
			case 'add':
			case 'update': {
				if (focusedOption.name === 'role') {
					await interaction.respond(sortAndLimitOptions(global.getUserRoles(false, null).concat(global.getUserRoles(true, null)), 25, search));
				}
				break;
			}
		}
	},
	async execute(interaction, member, perm, permName) {
		const subCommand = interaction.options.getSubcommand();
		switch (subCommand) {
			case 'add': {
				if (perm < global.PERM_RECRUITER)
					return interaction.reply({ content: "You do not have permissions to create channels", ephemeral: true });
				
				let name = interaction.options.getString('name');
				let channelName = name.toLowerCase().replace(/\s/g, '-');
				let type = interaction.options.getString('type') ?? 'voice';
				let level = interaction.options.getString('perm') ?? 'member';
				let category = interaction.options.getChannel('category');
				let roleName = interaction.options.getString('role');
				
				let officerRole;				
				if (category) {
					//check if this category has an associated officer role
					let officerRoleName = category.name + ' ' + global.config.discordOfficerSuffix;
					officerRole = interaction.guild.roles.cache.find(r => { return r.name == officerRoleName; });
					if (perm < global.PERM_DIVISION_COMMANDER)
						return interaction.reply({ content: "You do not have permissions to create permanent channels", ephemeral: true });
					if (perm == global.PERM_DIVISION_COMMANDER && (!officerRole || !member.roles.cache.get(officerRole.id)))
						return interaction.reply({ content: "You can only add channels to a division you command", ephemeral: true });
					if (perm < global.PERM_STAFF && category.children.size >= config.maxChannelsPerCategory)
						return interaction.reply({ content: "Category is full", ephemeral: true });
					
					let prefix = category.name.toLowerCase().replace(/\s/g, '-') + '-';
					if (channelName.indexOf(prefix) < 0)
						channelName = prefix + channelName;
				} else {
					if (type === 'text')
						return interaction.reply({ content: "A category must be set for text channels", ephemeral: true });
					
					category = interaction.guild.channels.cache.find(c => { return c.name == config.tempChannelCategory; });
					if (!category)
						return interaction.reply({ content: "Temp channel category not found", ephemeral: true });
				}
				
				let role;
				if (roleName)
					role = interaction.guild.roles.cache.find(r => { return r.name == roleName; });
				if (role) {
					if (level !== 'role')
						return interaction.reply({ content: "Channel Permissions must be 'role' if a Role is selected", ephemeral: true });
					if (perm < global.PERM_DIVISION_COMMANDER)
						return interaction.reply({ content: "You do not have permissions to create role locked channels", ephemeral: true });
				} else if (level === 'role') {
					return interaction.reply({ content: "Role must be provided if Channel Permissions is 'role'", ephemeral: true });
				}
				
				let existingChannel = interaction.guild.channels.cache.find(c => { return c.name == channelName; });
				if (existingChannel)
					return interaction.reply({ content: "Channel already exists", ephemeral: true });
				
				await interaction.deferReply({ ephemeral: true });
				return global.addChannel(interaction.guild, interaction, member, perm, channelName, type, level, category, officerRole, role);
			}
			case 'delete': {
				if (perm < global.PERM_DIVISION_COMMANDER)
					return interaction.reply({ content: "You do not have permissions to delete channels", ephemeral: true });
				
				let channel = interaction.options.getChannel('channel');
				let channelName = channel.name;
				if (global.config.protectedChannels.includes(channel.name))
					return interaction.reply({ content: `${channelName} is a protected channel.`, ephemeral: true });

				let category = channel.parent;
				if (category) {
					//check if this category has an associated officer role
					let officerRoleName = category.name + ' ' + global.config.discordOfficerSuffix;
					let officerRole = interaction.guild.roles.cache.find(r => { return r.name == officerRoleName; });
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
					const confirmation = await response.awaitMessageComponent({ filter: filter, time: 10_000 });
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
					await interaction.editReply({ content: 'Timeout waiting for confirmation', components: [] });
				}
				break;
			}
			case 'topic': {
				if (perm < global.PERM_MOD)
					return interaction.reply({ content: "You do not have permissions to set channel topics", ephemeral: true });
				let topic = interaction.options.getString('topic') ?? "";
				let channel = interaction.options.getChannel('channel') ?? interaction.channel;		
				if (!channel)
					return interaction.reply({ content: "Please provide a channel or execute in a text channel", ephemeral: true });	
				await interaction.deferReply({ ephemeral: true });
				return channel.setTopic(topic, `Requested by ${global.getNameFromMessage(interaction)}`);
			}
			case 'update': {
				if (perm < global.PERM_STAFF)
					return interaction.reply({ content: "You do not have permissions to update channel permissions", ephemeral: true });
				
				let level = interaction.options.getString('perm') ?? 'member';
				let roleName = interaction.options.getString('role');
				let channel = interaction.options.getChannel('channel') ?? interaction.channel;
				let channelName = channel.name;
				if (global.config.protectedChannels.includes(channel.name))
					return interaction.reply({ content: `${channelName} is a protected channel`, ephemeral: true });

				let category = channel.parent;
				let officerRole;
				if (category) {
					//check if this category has an associated officer role
					let officerRoleName = category.name + ' ' + global.config.discordOfficerSuffix;
					officerRole = interaction.guild.roles.cache.find(r => { return r.name == officerRoleName; });
					if (perm == global.PERM_DIVISION_COMMANDER && (!officerRole || !member.roles.cache.get(officerRole.id)))
						return interaction.reply({ content: 'You can only update channels from a division you command', ephemeral: true });
				} else {
					if (perm < PERM_STAFF)
						return interaction.reply({ content: 'You cannot update this channel', ephemeral: true });
				}
				
				let role;
				if (roleName)
					role = interaction.guild.roles.cache.find(r => { return r.name == roleName; });
				if (role) {
					if (level !== 'role')
						return interaction.reply({ content: "Channel Permissions must be 'role' if a Role is selected", ephemeral: true });
					if (perm < global.PERM_DIVISION_COMMANDER)
						return interaction.reply({ content: "You do not have permissions to create role locked channels", ephemeral: true });
				} else if (level === 'role') {
					return interaction.reply({ content: "Role must be provided if Channel Permissions is 'role'", ephemeral: true });
				}
				await interaction.deferReply({ ephemeral: true });
				return setChannelPerms(interaction.guild, interaction, member, perm, channel, level, category, officerRole, role);
			}
		}
	}
};

