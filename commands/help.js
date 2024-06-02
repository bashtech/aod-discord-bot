/* jshint esversion: 11 */

const { SlashCommandBuilder, PermissionFlagsBits, ApplicationCommandOptionType } = require('discord.js');

function objectWithNameSort(a, b) {
	if (a.name < b.name) return -1;
	if (a.name > b.name) return 1;
	return 0;
}

function buildSubCommandList(command, cmdOption, parentName, prefix, perm) {
	if (cmdOption.type === ApplicationCommandOptionType.Subcommand) {
		if (typeof(command.checkPerm) === 'function') {
			if (command.checkPerm(perm, cmdOption.name, parentName) !== true) {
				return [];
			}
		}
		return [`</${prefix} ${cmdOption.name}:${command.commandId}>: ${cmdOption.description}\n`];
	} else if (cmdOption.type === ApplicationCommandOptionType.SubcommandGroup) {
		let list = [];
		cmdOption.options.sort(objectWithNameSort).forEach(subCmdOption => {
			list = list.concat(buildSubCommandList(command, subCmdOption, cmdOption.name, `${prefix} ${cmdOption.name}`, perm));
		});
		return list;
	}
	return [];
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('help')
		.setDescription('Show list of available commands')
		.addStringOption(option => option.setName('command').setDescription('Command').setAutocomplete(true)),
	global: true,
	help: true,
	async autocomplete(interaction, guild, member, perm) {
		const focusedOption = interaction.options.getFocused(true);
		let search = focusedOption.value.toLowerCase();
		let commands = [];
		interaction.client.commands.each((command, name) => {
			if (command.help) {
				commands.push(name);
			}
		});
		return interaction.respond(global.sortAndLimitOptions(commands, 25, search));
	},
	async execute(interaction, guild, member, perm) {
		let filter = interaction.options.getString('command') ?? null;
		let embed = {
			title: "Available Commands",
			description: ""
		};

		interaction.client.commands.sort(objectWithNameSort).each(function(command, name) {
			if (command.help) {
				if (filter !== null && name !== filter) {
					return;
				}
				if (typeof(command.checkPerm) === 'function') {
					if (command.checkPerm(perm, name) !== true) {
						return;
					}
				}
				let guildCommand;
				if (!command.commandId) {
					guildCommand = guild.commands.cache.find(c => {
						return (c.applicationId === interaction.client.application.id && c.name === name);
					});
					if (guildCommand) {
						command.commandId = guildCommand.id;
					}
				} else {
					guildCommand = guild.commands.resolve(command.commandId);
				}
				if (guildCommand) {
					if (filter === null) {
						embed.description += `</${name}:${command.commandId}>: ${guildCommand.description}\n`;
						if (guildCommand.options.some(cmdOption => (cmdOption.type === ApplicationCommandOptionType.Subcommand ||
								cmdOption.type === ApplicationCommandOptionType.SubcommandGroup))) {
							embed.description += `\u3000\u2023</help:${interaction.commandId}> command:${name} for sub-commands\n`;
						}
					} else {
						let subCommands = '';
						guildCommand.options.sort(objectWithNameSort).forEach(cmdOption => {
							let subCommandList = buildSubCommandList(command, cmdOption, name, name, perm);
							subCommands += subCommandList.join('');
						});
						if (subCommands.length)
							embed.description += subCommands;
						else
							embed.description += `</${name}:${command.commandId}>: ${guildCommand.description}\n`;
					}
				} else {
					embed.description += `/${name}\n`;
				}
			}
		});
		await interaction.reply({ embeds: [embed], ephemeral: true });
		if (!interaction.inGuild()) {
			return interaction.followUp('Please note, most commands must be executed in a text channel of the Discord server.');
		}
		return Promise.resolve();
	},
};
