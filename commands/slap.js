/* jshint esversion: 8 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('slap')
		.setDescription('Slap someone with a trout or other object')
		.addUserOption(option => option.setName('user').setDescription('User').setRequired(true))
		.addStringOption(option => option.setName('object').setDescription('Object').setRequired(false)),
	help: 'Slap someone with a trout or other object.',
	async execute(interaction, member, perm, permName) {
		let targetMember = interaction.options.getMember('user');
		let object = interaction.options.getString('object') ?? 'a large trout';

		if (!interaction.channel)
			return interaction.reply({ content: "You can only slap people in text channels", ephemeral: true });

		return interaction.channel.send(`_${member} slaps ${targetMember} around a bit with ${object}._`)
			.then(() => { message.delete(); })
			.catch(() => {});
	},
};
