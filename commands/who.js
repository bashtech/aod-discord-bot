/* jshint esversion: 8 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('who')
		.setDescription('Get information about a member')
		.addUserOption(option => option.setName('user').setDescription('User').setRequired(true)),
	help: true,
	async execute(interaction, member, perm, permName) {
		if (perm < global.PERM_MEMBER) {
			return interaction.reply('You do not have permissions to use this command.');
		}
		await interaction.deferReply({ ephemeral: true });
		
		let targetMember = interaction.options.getMember('user');
		userData = await global.getForumInfoForMember(targetMember);
		
		reply = `Information for ${targetMember}:\n`;
		
		if (!userData || userData.length == 0) {
			reply += `User is not registered on the forums.\n`;
		} else {
			reply += `Found the following forum information:\n`;
			for (let i = 0; i < userData.length; i++) {
				let data = userData[i];
				reply += `User: ${data.name}  Division: ${data.division}  Rank: ${data.rank}  Status: ${data.loaStatus}\n`;
			}
		}
		if (targetMember.voice.channel) {
			reply += `User is currently in ${targetMember.voice.channel}`;
		}

		interaction.replied = true; //avoid common reply
		return interaction.editReply({ content: reply, ephemeral: true });
	},
};
