/* jshint esversion: 11 */

const { SlashCommandBuilder, PermissionFlagsBits, ApplicationCommandOptionType } = require('discord.js');

function objectWithNameSort(a, b) {
	if (a.name < b.name) return -1;
	if (a.name > b.name) return 1;
	return 0;
}

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
	help: true,
	async autocomplete(interaction, member, perm, permName) {
		const focusedOption = interaction.options.getFocused(true);
		let search = focusedOption.value.toLowerCase();
		let commands = [];
		interaction.client.commands.each((command, name) => {
			if (command.help) {
				commands.push(name);
			}
		});
		await interaction.respond(sortAndLimitOptions(commands, 25, search));
	},
	async execute(interaction, member, perm, permName) {
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
					if (command.checkPerm(name, perm) !== true) {
						return;
					}
				}
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
					if (filter === null) {
						embed.description += `</${name}:${command.commandId}>: ${guildCommand.description}\n`;
						if (guildCommand.options.some(cmdOption => (cmdOption.type === ApplicationCommandOptionType.Subcommand ||
								cmdOption.type === ApplicationCommandOptionType.SubcommandGroup))) {
							embed.description += `\u3000\u2023</help:${interaction.command.id}> command:${name} for sub-commands\n`;
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
		return interaction.reply({ embeds: [embed], ephemeral: true });
	},
};
