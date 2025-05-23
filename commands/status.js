/* jshint esversion: 8 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('status')
		.setDescription('AOD bot status')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
	global: true,
	help: true,
	checkPerm(perm, commandName, parentName) {
		return perm >= global.PERM_ADMIN;
	},
	async execute(interaction, guild, member, perm) {
		let uptimeSeconds = Math.round(interaction.client.uptime / 1000);
		let now = new Date();
		let lastForumSyncDiff = new Date(now - global.lastForumSync);
		//let nextTimerSeconds = ((nextSavedTimerEpoch ? nextSavedTimerEpoch : now.getTime()) - now.getTime()) / 1000;
		let embed = {
			title: 'Bot Status',
			fields: [
				{ name: 'UpTime', value: global.secondsToString(uptimeSeconds) },
				{ name: 'Server Status', value: `${guild.name} has ${guild.members.cache.size} members and ${guild.channels.cache.size} channels` },
				{ name: 'Last Forum Sync', value: `${lastForumSyncDiff.getMinutes()} minutes, ${lastForumSyncDiff.getSeconds()} seconds ago` },
				{ name: 'Average WebSocket Hearbeat Time', value: `${interaction.client.ws.ping}ms` },
				/*{ name: 'Timers', value: `${savedTimers.length} timers, next timer expires in ${global.secondsToString(nextTimerSeconds)}` },*/
			]
		};
		return global.ephemeralReply(interaction, { embeds: [embed] });
	},
};
