/* jshint esversion: 8 */

const {
	SlashCommandBuilder,
	ContextMenuCommandBuilder,
	ApplicationCommandType,
	PermissionFlagsBits,
	PermissionsBitField,
	ChannelType,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle
} = require('discord.js');

function getComponentsForTarget(member, perm, targetMember, targetPerm, invite) {
	let components = [];
	if (member.id === targetMember.id) {
		return components;
	}

	const voiceRow = new ActionRowBuilder();
	let canMove = false;
	let canDisconnect = false;
	if (member.voice.channel && member.voice.channelId !== targetMember.voice.channelId) {
		//create invite button
		if (invite === true) {
			const invite = new ButtonBuilder()
				.setCustomId('send_invite')
				.setLabel('Invite to your channel')
				.setStyle(ButtonStyle.Primary);
			voiceRow.addComponents(invite);
		}

		//if the target is in a voie channel, check if member can move them
		if (perm >= global.PERM_RECRUITER) {
			if (targetMember.voice.channel) {
				canMove = member.permissions.has(PermissionsBitField.Flags.MoveMembers);
				if (!canMove) {
					let category = member.voice.channel.parent;
					let officerRole;
					if (category) {
						//check if this category has an associated officer role
						let officerRoleName = category.name + ' ' + global.config.discordOfficerSuffix;
						officerRole = member.guild.roles.cache.find(r => { return r.name == officerRoleName; });
					}
					if (officerRole && member.roles.resolve(officerRole.id)) {
						if (targetMember.voice.channel.parent.id === category.id ||
							targetMember.voice.channel.name === 'Lobby') {
							canMove = true;
						}
					}
				}
			}
		}
	}
	if (targetMember.voice) {
		if (perm >= global.PERM_RECRUITER && targetPerm < perm) {
			if (perm >= global.PERM_MOD) {
				canDisconnect = true;
			} else {
				let category = targetMember.voice.channel.parent;
				let officerRole;
				if (category) {
					//check if this category has an associated officer role
					let officerRoleName = category.name + ' ' + global.config.discordOfficerSuffix;
					officerRole = member.guild.roles.cache.find(r => { return r.name == officerRoleName; });
				}
				if (officerRole && member.roles.resolve(officerRole.id)) {
					canDisconnect = true;
				}
			}
		}
	}

	//if member has permission to move target, create a move button
	if (canMove) {
		const move = new ButtonBuilder()
			.setCustomId('move_to_me')
			.setLabel('Move to your channel')
			.setStyle(ButtonStyle.Danger);
		voiceRow.addComponents(move);
	}
	//if member has permission to disconnect target, create a disconnect button
	if (canDisconnect) {
		const disconnect = new ButtonBuilder()
			.setCustomId('disconnect')
			.setLabel('Disconnect')
			.setStyle(ButtonStyle.Danger);
		voiceRow.addComponents(disconnect);
	}
	if (voiceRow.components.length) {
		components.push(voiceRow);
	}

	if (perm >= global.PERM_MOD && perm > targetPerm) {
		const modRow = new ActionRowBuilder();
		if (targetMember.voice.channel) {
			if (targetMember.voice.serverMute) {
				const unmute = new ButtonBuilder()
					.setCustomId('server_unmute')
					.setLabel('Unmute Voice')
					.setStyle(ButtonStyle.Primary);
				modRow.addComponents(unmute);
			} else {
				const mute = new ButtonBuilder()
					.setCustomId('server_mute')
					.setLabel('Mute Voice')
					.setStyle(ButtonStyle.Danger);
				modRow.addComponents(mute);
			}

			if (targetMember.voice.serverDeaf) {
				const unmute = new ButtonBuilder()
					.setCustomId('server_undeaf')
					.setLabel('Undeafen')
					.setStyle(ButtonStyle.Primary);
				modRow.addComponents(unmute);
			} else {
				const mute = new ButtonBuilder()
					.setCustomId('server_deaf')
					.setLabel('Deafen')
					.setStyle(ButtonStyle.Danger);
				modRow.addComponents(mute);
			}
		}

		let muteRole = targetMember.roles.cache.find(r => r.name === global.config.muteRole);
		if (muteRole) {
			const unmute = new ButtonBuilder()
				.setCustomId('remove_mute_role')
				.setLabel('Remove Mute Role')
				.setStyle(ButtonStyle.Primary);
			modRow.addComponents(unmute);
		} else {
			const mute = new ButtonBuilder()
				.setCustomId('add_mute_role')
				.setLabel('Add Mute Role')
				.setStyle(ButtonStyle.Danger);
			modRow.addComponents(mute);
		}

		let pttRole = targetMember.roles.cache.find(r => r.name === global.config.pttRole);
		if (pttRole) {
			const unsetptt = new ButtonBuilder()
				.setCustomId('remove_ptt_role')
				.setLabel('Remove PTT Role')
				.setStyle(ButtonStyle.Primary);
			modRow.addComponents(unsetptt);
		} else {
			const setptt = new ButtonBuilder()
				.setCustomId('add_ptt_role')
				.setLabel('Add PTT Role')
				.setStyle(ButtonStyle.Danger);
			modRow.addComponents(setptt);
		}
		components.push(modRow);
	}
	return components;
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('who')
		.setDescription('Get information about a member')
		.addUserOption(option => option.setName('user').setDescription('User').setRequired(true)),
	menuCommands: [
		new ContextMenuCommandBuilder()
			.setName('Who')
			.setType(ApplicationCommandType.User)
	],
	help: true,
	checkPerm(perm, commandName) {
		return perm >= global.PERM_MEMBER;
	},
	async execute(interaction, member, perm, permName) {
		await interaction.deferReply({ ephemeral: true });

		const targetMember = interaction.options.getMember('user');
		const userData = await global.getForumInfoForMember(targetMember);
		const memberRole = interaction.guild.roles.cache.find(r => { return r.name == global.config.memberRole; });

		let embed = {
			description: `**Information for ${targetMember}**`,
			thumbnail: { url: targetMember.displayAvatarURL({ extension: 'png' }) },
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
					value: `**Username**: ${data.name}\n` +
						`**Division**: ${data.division}\n` +
						`**Rank**: ${data.rank}\n` +
						`**Status**: ${data.loaStatus}\n` +
						`[[Profile](https://www.clanaod.net/forums/member.php?u=${data.id})]\n`
				});
				const memberRoleName = global.config.memberRole;
				if (targetMember.roles.cache.find(r => r.name === memberRoleName)) {
					embed.fields.push({
						name: 'Tracker Data',
						value: `[[Profile](${global.config.trackerURL}/members/${data.id})]`
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
				.sort((r1, r2) => r2.position - r1.position)
				.map(r => `${r}`)
				.join(', ')
		});

		let [targetPerm, targetPermName] = getPermissionLevelForMember(targetMember);
		let components = getComponentsForTarget(member, perm, targetMember, targetPerm, true);

		interaction.replied = true; //avoid common reply
		const response = await global.ephemeralReply(interaction, { embeds: [embed], components: components }, true);
		if (components.length) {
			const buttons = ['send_invite', 'move_to_me', 'disconnect',
				'server_unmute', 'server_mute', 'server_undeaf', 'server_deaf',
				'remove_mute_role', 'add_mute_role', 'remove_ptt_role', 'add_ptt_role'];
			const filter = (i) => i.user.id === interaction.user.id && buttons.includes(i.customId);
			try {
				while (1) {
					const confirmation = await response.awaitMessageComponent({ filter: filter, time: 15000 });
					console.log(`${getNameFromMessage(interaction)} executed: button:who:${confirmation.customId}:${targetMember.id}`);
					switch (confirmation.customId) {
						case 'send_invite': {
							let invite = await member.voice.channel.createInvite({
								maxAge: 5 * 60, //5 minutes
								maxUses: 1,
								temporary: true,
								reason: `Requested by ${global.getNameFromMessage(interaction)}`
							});
							if (invite) {
								await targetMember.send(`${member} has invited you to their voice channel: ${invite.url}`);
								global.ephemeralReply(interaction, { content: 'Invitation sent' });
							} else {
								global.ephemeralReply(interaction, { content: 'Failed to create invitation.' });
							}
							break;
						}
						case 'move_to_me': {
							await targetMember.voice.setChannel(member.voice.channelId).catch(console.log);
							break;
						}
						case 'disconnect': {
							await targetMember.voice.disconnect().catch(console.log);
							break;
						}
						case 'server_unmute': {
							await targetMember.voice.setMute(false, `Requested by ${global.getNameFromMessage(interaction)}`).catch(console.log);
							break;
						}
						case 'server_mute': {
							await targetMember.voice.setMute(true, `Requested by ${global.getNameFromMessage(interaction)}`).catch(console.log);
							break;
						}
						case 'server_undeaf': {
							await targetMember.voice.setDeaf(false, `Requested by ${global.getNameFromMessage(interaction)}`).catch(console.log);
							break;
						}
						case 'server_deaf': {
							await targetMember.voice.setDeaf(true, `Requested by ${global.getNameFromMessage(interaction)}`).catch(console.log);
							break;
						}
						case 'remove_mute_role': {
							await addRemoveRole(interaction, interaction.guild, false, global.config.muteRole, targetMember, true);
							break;
						}
						case 'add_mute_role': {
							await addRemoveRole(interaction, interaction.guild, true, global.config.muteRole, targetMember, true);
							break;
						}
						case 'remove_ptt_role': {
							await addRemoveRole(interaction, interaction.guild, false, global.config.pttRole, targetMember, true);
							break;
						}
						case 'add_ptt_role': {
							await addRemoveRole(interaction, interaction.guild, true, global.config.pttRole, targetMember, true);
							break;
						}
					}
					components = getComponentsForTarget(member, perm, targetMember, targetPerm);
					confirmation.update({ components: components });
					if (!components.length) {
						break;
					}
				}
			} catch (e) {
				global.ephemeralReply(interaction, { components: [] }, true);
			}
		}
	},
	async menu(interaction, member, perm, permName) {
		return module.exports.execute(interaction, member, perm, permName);
	}
};
