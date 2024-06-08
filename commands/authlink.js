/* jshint esversion: 11 */

const {
	SlashCommandBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle
} = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('authlink')
		.setDescription('Generate a URL to associate your Discord user to the ClanAOD.net Forums'),
	global: true,
	help: true,
	checkPerm(perm, commandName, parentName) {
		return true;
	},
	async execute(interaction, guild, member, perm) {
		await interaction.deferReply({ ephemeral: true });
		let token = await global.getLoginToken(member).catch(() => {});
		if (token) {
			const login = new ButtonBuilder()
				.setLabel('ClanAOD.net Login')
				.setURL(`https://www.clanaod.net/forums/aoddiscordauth.php?token=${token}`)
				.setStyle(ButtonStyle.Link);
			const row = new ActionRowBuilder()
				.addComponents(login);
			return global.ephemeralReply(interaction, {
				embeds: [{
					title: 'ClanAOD.net Login',
					description: 'Click the button below to associate your Discord user to your ClanAOD.net forum account. The link is valid for 15 minutes.',
					thumbnail: {
						url: interaction.client.user.avatarURL({ extension: 'png' })
					}
				}],
				components: [row]
			});
		} else {
			return global.ephemeralReply(interaction, "Failed to generate login token");
		}
	}
};
