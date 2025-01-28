/* jshint esversion: 8 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('officers')
		.setDescription('List the officers for a Division.')
		.addStringOption(option => option.setName('role').setDescription('Role').setAutocomplete(true).setRequired(false)),
	help: true,
	async autocomplete(interaction, guild, member, perm) {
		const focusedOption = interaction.options.getFocused(true);
		let search = focusedOption.value.toLowerCase();
		if (focusedOption.name === 'role') {
			let guildRoles = [];
			for (let role of guild.roles.cache.values()) {
				if (role.name.endsWith(config.discordOfficerSuffix)) {
					guildRoles.push(role.name);
				}
			}
			return interaction.respond(global.sortAndLimitOptions(guildRoles, 25, search));
		}
		return Promise.reject();
	},
	async execute(interaction, guild, member, perm) {
		let roleName = interaction.options.getString('role');
		let officerRole;
		if (!roleName || roleName === '') {
			let category = interaction.channel.parent;
			if (category) {
				roleName = category.name + ' ' + global.config.discordOfficerSuffix;
				officerRole = guild.roles.cache.find(r => { return r.name == roleName; });
			}
		} else {
			officerRole = guild.roles.cache.find(r => { return r.name == roleName; });
		}
		if (!officerRole) {
			return global.ephemeralReply(interaction, { content: 'Please choose an officer role or run the command in a division channel.' });
		}

		let reply = `${roleName}s\n`;
		officerRole.members.each(m => {
			reply += `${m}\n`;
		});
		return global.ephemeralReply(interaction, { content: reply });
	},
};
