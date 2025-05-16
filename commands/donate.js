/* jshint esversion: 8 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('donate')
		.setDescription('Show donation message'),
	help: true,
	async execute(interaction) {
		return messageReply(interaction, {
			"id": 652627557,
			"title": "ClanAOD Stack Up Donation Drive",
			"description": "ClanAOD is proud to support Stack Up, a charity dedicated to supporting veterans and active-duty military through the power of gaming. We’re raising funds to help provide mental health support, supply crates, and community programs that make a real difference. Join us in making an impact—every donation counts!",
			"color": 2326507,
			"fields": [],
			"image": {
				"url": "https://i.imgur.com/KFOjz3Y.png"
			},
			"url": "https://tiltify.com/+clan-aod-stream-team/2025-clan-aod-24-hour-stream",
			"thumbnail": {
				"url": "https://i.imgur.com/3j76uUf.png"
			},
			"author": {
			"icon_url": "https://i.imgur.com/3j76uUf.png",
			"name": "ClanAOD"
			}
		});
	},
};
