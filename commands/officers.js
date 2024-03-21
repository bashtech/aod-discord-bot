/* jshint esversion: 8 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

function sortAndLimitOptions(options, len, search) {
	let count = 0;
	return options
		.sort()
		.filter(o => {
			if (count >= len) {
				return false;
			} else if (o.toLowerCase().startsWith(search)) {
				count++;
				return true;
			} else {
				return false;
			}
		})
		.map(o => ({ name: o, value: o }));
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('officers')
		.setDescription('List the officers for a Division.')
		.addStringOption(option => option.setName('role').setDescription('Role').setAutocomplete(true).setRequired(false)),
	help: true,
	async autocomplete(interaction, member, perm, permName) {
		const focusedOption = interaction.options.getFocused(true);
		let search = focusedOption.value.toLowerCase();
		if (focusedOption.name === 'role') {
			let guildRoles = [];
			for (let role of interaction.guild.roles.cache.values()) {
				if (role.name.endsWith(config.discordOfficerSuffix)) {
					guildRoles.push(role.name);
				}
			}
			return interaction.respond(sortAndLimitOptions(guildRoles, 25, search));
		}
	},
	async execute(interaction, member, perm, permName) {
		let roleName = interaction.options.getString('role');
		let officerRole;
		if (!roleName || roleName === '') {
			let category = interaction.channel.parent;
			if (category) {
				roleName = category.name + ' ' + global.config.discordOfficerSuffix;
				officerRole = interaction.guild.roles.cache.find(r => { return r.name == roleName; });
			}
		} else {
			officerRole = interaction.guild.roles.cache.find(r => { return r.name == roleName; });
		}
		if (!officerRole) {
			return interaction.reply({ content: 'Please choose an officer role or run the command in a division channel.', ephemeral: true });
		}
		
		let reply = `${roleName}s\n`;
		officerRole.members.each(m => {
			reply += `${m}\n`;
		});
		return interaction.reply({ content: reply, ephemeral: true });
	},
};
