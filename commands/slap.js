/* jshint esversion: 11 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('slap')
		.setDescription('Slap someone with a trout or other object')
		.addUserOption(option => option.setName('user').setDescription('User').setRequired(true))
		.addStringOption(option => option.setName('object').setDescription('Object').setRequired(false)),
	help: true,
	async execute(interaction, guild, member, perm) {
		let targetMember = interaction.options.getMember('user');
		let object = interaction.options.getString('object') ?? 'a large trout';

		if (!interaction.channel)
			return global.ephemeralReply(interaction, { content: "You can only slap people in text channels" });

		return interaction.channel.send(`_${member} slaps ${targetMember} around a bit with ${object}._`)
			.then(() => { message.delete(); })
			.catch(() => {});
	},
};
