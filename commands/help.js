/* jshint esversion: 8 */

const { SlashCommandBuilder, PermissionFlagsBits, ApplicationCommandOptionType } = require('discord.js');

function objectWithNameSort(a, b) {
	if (a.name < b.name) return -1;
	if (a.name > b.name) return 1;
	return 0;
}

function buildSubCommandList(command, cmdOption, parentName) {
	if (cmdOption.type === ApplicationCommandOptionType.Subcommand) {
		return [`</${parentName} ${cmdOption.name}:${command.commandId}>: ${cmdOption.description}\n`];
	} else if (cmdOption.type === ApplicationCommandOptionType.SubcommandGroup) {
		let list = [];
		cmdOption.options.sort(objectWithNameSort).forEach(subCmdOption => {
			list.concat(buildSubCommandList(command, subCmdOption, `${parentName} ${cmdOption.name}`));
		});
		return list;
	}
	return [];
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('help')
		.setDescription('Show list of available commands'),
	help: "Show list of available commands.",
	async execute(interaction) {
		let embed = {
			title: "Available Commands",
			description: ""
		};

		interaction.client.commands.sort().each(function (command, name) {
			if (command.help) {
				let guildCommand;
				if (!command.commandId) {
					guildCommand = interaction.guild.commands.cache.find(c => { 
						return (c.applicationId === interaction.client.application.id && c.name === name); 
					});
					if (guildCommand) {
						command.commandId = guildCommand.id;
					}
				} else {
					guildCommand = interaction.guild.commands.resolve(command.commandId);
				}
				if (guildCommand) {
					let subCommands = ""
					guildCommand.options.sort(objectWithNameSort).forEach(cmdOption => {
						let subCommandList = buildSubCommandList(command, cmdOption, name);
						subCommands += subCommandList.join();
					});
					if (subCommands.length)
						embed.description += subCommands;
					else
						embed.description += `</${name}:${command.commandId}>: ${guildCommand.description}\n`;
				} else {
					embed.description += `/${name}: ${command.help}`;
				}
			}
		});
		return interaction.reply({ embeds: [embed], ephemeral: true });
	},
};
