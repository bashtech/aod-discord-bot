/* jshint esversion: 11 */

const {
	SlashCommandBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle
} = require('discord.js');
const config = require("../config/aod-discord-bot.config.json");

const deleteMessagesChoices = [
	{ name: 'None', value: 0 },
	{ name: '10 minutes', value: 600 },
	{ name: '30 minutes', value: 1800 },
	{ name: '1 hour', value: 3600 },
	{ name: '1 day', value: 86400 },
	{ name: '7 day', value: 604800 },
];

module.exports = {
	data: new SlashCommandBuilder()
		.setName('user')
		.setDescription('Manage a user')
		.addSubcommand(command => command.setName('kick').setDescription('Kicks a user from the server')
			.addUserOption(option => option.setName('user').setDescription('User').setRequired(true))
			.addStringOption(option => option.setName('reason').setDescription('Kick reason').setRequired(true)))
		.addSubcommand(command => command.setName('ban').setDescription('Bans a user from the server')
			.addUserOption(option => option.setName('user').setDescription('User').setRequired(true))
			.addStringOption(option => option.setName('reason').setDescription('Ban reason').setRequired(true))
			.addIntegerOption(option => option.setName('delete-messages').setDescription('Message purge duration').addChoices(...deleteMessagesChoices))),
	help: true,
	checkPerm(perm, commandName) {
		switch (commandName) {
			case 'user':
			case 'kick':
				return perm >= global.PERM_RECRUITER;
			case 'ban':
				return perm >= global.PERM_MOD;
		}
		return false;
	},
	async execute(interaction, member, perm, permName) {
		const subCommand = interaction.options.getSubcommand();
		let targetMember = interaction.options.getMember('user');

		if (targetMember) {
			// Validate caller has permissions to kick/ban target if they are a member of the server
			let [targetPerm, targetPermName] = global.getPermissionLevelForMember(targetMember);
			if (!targetMember.kickable || perm <= targetPerm)
				return global.ephemeralReply(interaction, `You do not have permissions to ${subCommand} ${targetMember}.`);
		}

		switch (subCommand) {
			case 'kick': {
				if (!targetMember)
					return global.ephemeralReply(interaction, 'User is invalid or left the server.');

				let reason = interaction.options.getString('reason');

				const confirm = new ButtonBuilder()
					.setCustomId('confirm_user_kick')
					.setLabel('Confirm Kick')
					.setStyle(ButtonStyle.Danger);
				const cancel = new ButtonBuilder()
					.setCustomId('cancel_user_kick')
					.setLabel('Cancel')
					.setStyle(ButtonStyle.Secondary);
				const row = new ActionRowBuilder()
					.addComponents(cancel, confirm);
				const response = await global.ephemeralReply(interaction, {
					content: `Are you sure you want to kick ${targetMember} from the server?`,
					components: [row]
				});

				const filter = (i) => (i.customId === 'confirm_user_kick' || i.customId === 'cancel_user_kick') && i.user.id === interaction.user.id;
				try {
					const confirmation = await response.awaitMessageComponent({ filter: filter, time: 10000 });
					if (confirmation.customId === 'confirm_user_kick') {
						await targetMember.kick(`Requested by ${global.getNameFromMessage(interaction)}: ${reason}`)
							.catch(error => global.ephemeralReply(interaction, `Sorry, I couldn't kick because of : ${error}`));
						await confirmation.update({
							content: `${targetMember} has been kicked for: ${reason}`,
							components: []
						}).catch(() => {});
						await global.sendGlobalNotification(interaction.guild, `${targetMember} has been kicked by ${member} for: ${reason}`);
					} else if (confirmation.customId === 'cancel_user_kick') {
						await confirmation.update({
							content: 'Kick request cancelled',
							components: []
						});
					}
				} catch (e) {
					await interaction.editReply({ content: 'Timeout waiting for confirmation', components: [], ephemeral: true });
				}
				break;
			}
			case 'ban': {
				let userToBan = targetMember ?? interaction.options.getUser('user');
				let reason = interaction.options.getString('reason');
				let purgeDuration = interaction.options.getInteger('delete-messages') ?? 0;

				const confirm = new ButtonBuilder()
					.setCustomId('confirm_user_ban')
					.setLabel('Confirm Ban')
					.setStyle(ButtonStyle.Danger);
				const cancel = new ButtonBuilder()
					.setCustomId('cancel_user_ban')
					.setLabel('Cancel')
					.setStyle(ButtonStyle.Secondary);
				const row = new ActionRowBuilder()
					.addComponents(cancel, confirm);
				const response = await global.ephemeralReply(interaction, {
					content: `Are you sure you want to ban ${userToBan} from the server?`,
					components: [row],
					ephemeral: true
				});

				const filter = (i) => (i.customId === 'confirm_user_ban' || i.customId === 'cancel_user_ban') && i.user.id === interaction.user.id;
				try {
					const confirmation = await response.awaitMessageComponent({ filter: filter, time: 10000 });
					if (confirmation.customId === 'confirm_user_ban') {
						await interaction.guild.members.ban(userToBan, { reason: `Requested by ${global.getNameFromMessage(interaction)}: ${reason}`, deleteMessageSeconds: purgeDuration })
							.catch(error => global.ephemeralReply(interaction, `Sorry, I couldn't ban because of : ${error}`));
						await confirmation.update({
							content: `${userToBan} has been banned for: ${reason}`,
							components: []
						}).catch(() => {});
						await global.sendGlobalNotification(interaction.guild, `${userToBan} has been banned by ${member} for: ${reason}`);
					} else if (confirmation.customId === 'cancel_user_ban') {
						await confirmation.update({
							content: 'Ban request cancelled',
							components: []
						});
					}
				} catch (e) {
					await interaction.editReply({ content: 'Timeout waiting for confirmation', components: [], ephemeral: true });
				}
				break;
			}
		}
	}
};
