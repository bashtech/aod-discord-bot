/* jshint esversion: 8 */

const { SlashCommandBuilder, PermissionFlagsBits, ApplicationCommandOptionType } = require('discord.js');

function buildSubCommandList(command, cmdOption, parentName) {
	if (cmdOption.type === ApplicationCommandOptionType.Subcommand) {
		return [`</${parentName} ${cmdOption.name}:${command.commandId}>`];
	} else if (cmdOption.type === ApplicationCommandOptionType.SubcommandGroup) {
		let list = [];
		cmdOption.options.sort(function(a,b) { return a.name<b.name; }).forEach(subCmdOption => {
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
		let reply = "Available Commands\n";

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
					reply += `</${name}:${command.commandId}>: ${command.help}\n`;
					let subCommands = ""
					guildCommand.options.sort(function(a,b) { return a.name<b.name; }).forEach(cmdOption => {
						let subCommandList = buildSubCommandList(command, cmdOption, name);
							if (subCommandList.length > 0) {
								if (subCommands.length > 0)
									subCommands += ', ';
								subCommands += subCommandList.join(', ')
						}
					});
					if (subCommands.length > 0)
						reply += `> Subcommands: ${subCommands}\n`;
				} else {
					reply += `/${name}: ${command.help}`;
				}
			}
		});
		return interaction.reply({ content: reply, ephemeral: true });
	},
};
