/* jshint esversion: 8 */

const {
	SlashCommandBuilder,
	PermissionFlagsBits,
	PermissionsBitField,
	ChannelType,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle
} = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('who')
		.setDescription('Get information about a member')
		.addUserOption(option => option.setName('user').setDescription('User').setRequired(true)),
	help: true,
	checkPerm(commandName, perm, parentName) {
		return perm >= global.PERM_MEMBER;
	},
	async execute(interaction, member, perm, permName) {
		if (perm < global.PERM_MEMBER) {
			return interaction.reply('You do not have permissions to use this command.');
		}
		await interaction.deferReply({ ephemeral: true });
		
		let targetMember = interaction.options.getMember('user');
		const userData = await global.getForumInfoForMember(targetMember);
		const memberRole = interaction.guild.roles.cache.find(r => { return r.name == global.config.memberRole; });
		
		let embed = {
			description: `**Information for ${targetMember}**`,
			thumbnail: { url: targetMember.displayAvatarURL({extension: 'png'}) },
			fields: []
		};
		
		embed.fields.push({
			name: 'Discord User',
			value: `${targetMember.user.username} (${targetMember.id})`
		});
		
		if (!userData || userData.length == 0) {
			embed.fields.push({
				name: 'Forum Data',
				value: 'User is not registered on the forums.'
			});
		} else {
			for (let i = 0; i < userData.length; i++) {
				let data = userData[i];
				embed.fields.push({
					name: 'Forum Data',
					value: 
						`**Username**: ${data.name} (${data.id})\n` +
						`**Division**: ${data.division}\n` +
						`**Rank**: ${data.rank}\n` +
						`**Status**: ${data.loaStatus}\n`
				});
				const memberRoleName = global.config.memberRole;
				if (targetMember.roles.cache.find(r => r.name === memberRoleName)) {
					embed.fields.push({
						name: 'Tracker Link',
						value: `${global.config.trackerURL}/members/${data.id}`
					});
				}
			}
		}
		if (targetMember.voice.channel) {
			embed.fields.push({
				name: 'Voice Channel',
				value: `${targetMember.voice.channel}`
			});
		}

		embed.fields.push({
			name: 'Roles',
			value: targetMember.roles.cache
				.filter(r => r != interaction.guild.roles.everyone)
				.sort((r1,r2) => r2.position - r1.position)
				.map(r => `${r}`)
				.join(', ')
		});

		let components = [];
		if (member.voice.channel && member.voice.channelId !== targetMember.voice.channelId) {
			const row = new ActionRowBuilder();
			const invite = new ButtonBuilder()
				.setCustomId('send_invite')
				.setLabel('Invite to your channel')
				.setStyle(ButtonStyle.Primary);
			row.addComponents(invite);
			if (member.permissions.has(PermissionsBitField.Flags.MoveMembers)) {
				const move = new ButtonBuilder()
					.setCustomId('move_to_me')
					.setLabel('Move to your channel')
					.setStyle(ButtonStyle.Danger);
				row.addComponents(move);
			}
			components.push(row);
		}

		interaction.replied = true; //avoid common reply
		const response = await interaction.editReply({ embeds: [embed], components: components, ephemeral: true });
		if (components.length) {
			const filter = (i) => (i.customId === 'send_invite' || i.customId === 'move_to_me') && i.user.id === interaction.user.id;
			try {
				const confirmation = await response.awaitMessageComponent({ filter: filter, time: 10000 });
				if (confirmation.customId === 'send_invite') {
					confirmation.update({
						components: []
					});
					let invite = await member.voice.channel.createInvite({
						maxAge: 5 * 60, /* 5 minutes */
						maxUses: 1,
						temporary: true,
						reason: `Requested by ${global.getNameFromMessage(interaction)}`
					});
					if (invite) {
						await targetMember.send(`${member} has invited you to their voice channel: ${invite.url}`);
						await interaction.followUp({content: 'Intivation sent.', ephemeral: true});
					} else {
						await interaction.followUp({content: 'Failed to create invitation.', ephemeral: true});
					}
				} else if (confirmation.customId === 'move_to_me') {
					confirmation.update({
						components: []
					});
					await targetMember.voice.setChannel(member.voice.channelId);
					await interaction.followUp({content: `${targetMember} moved to your channel.`, ephemeral: true});
				}
			} catch (e) {
				await interaction.editReply({components: []});
			}
		}
	},
};
