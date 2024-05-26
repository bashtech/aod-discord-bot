/* jshint esversion: 11 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const { execFile } = require('node:child_process');

const fs = require('node:fs');

const cmdOptions = {
	timeout: 30 * 1000 //30 seconds
};

function run(cmd, args) {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, (error, stdout, stderr) => {
			if (error && !stdout) {
				console.log(error);
			}
			resolve(stdout);
		}, cmdOptions);
	});
}

const projectActions = [
	{ name: 'Deploy', value: 'deploy' },
	{ name: 'Restart Service', value: 'restart-service' },
	{ name: 'Restart Supervisor', value: 'restart-supervisor' },
	{ name: 'Revert', value: 'revert-deployment' },
	{ name: 'Toggle Maintenance', value: 'toggle-maintenance' },
	{ name: 'Tracker Sync', value: 'tracker-sync' },
	{ name: 'Update NPM', value: 'update-npm' },
	{ name: 'Update PHP', value: 'update-php' },
];

module.exports = {
	data: new SlashCommandBuilder()
		.setName('deploy')
		.setDescription('Deploy AOD Services')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addSubcommand(command => command.setName('update-slash-commands').setDescription('Redpeloy slash commands to discord API'))
		.addSubcommand(command => command.setName('reload-slash-commands').setDescription('Reload slash command plugins'))
		.addSubcommand(command => command.setName('reload-api').setDescription('Reload API plugins and restart API server'))
		.addSubcommand(command => command.setName('git-project').setDescription('Manage git project')
			.addStringOption(option => option.setName('name').setDescription('Project Name').setAutocomplete(true).setRequired(true))
			.addStringOption(option => option.setName('action').setDescription('Action').setRequired(true).setChoices(...projectActions)))
		.addSubcommand(command => command.setName('reload-config').setDescription('Reload discord bot config'))
		.addSubcommand(command => command.setName('restart').setDescription('Restart discord bot')),
	help: true,
	checkPerm(perm, commandName, parentName) {
		return perm >= global.PERM_ADMIN;
	},
	async autocomplete(interaction, member, perm, permName) {
		const subCommand = interaction.options.getSubcommand();
		const focusedOption = interaction.options.getFocused(true);
		let search = focusedOption.value.toLowerCase();

		switch (subCommand) {
			case 'git-project': {
				if (focusedOption.name === 'name') {
					let options = [];
					try {
						let config = JSON.parse(fs.readFileSync(global.config.deployProjectConfig, 'utf8'));
						for (let project in config.projects) {
							if (config.projects.hasOwnProperty(project)) {
								options.push(project);
							}
						}
					} catch (err) {

					}
					return interaction.respond(global.sortAndLimitOptions(options, 25, search));
				}
				break;
			}
		}
		return Promise.reject();
	},
	async execute(interaction, member, perm, permName) {
		const subCommand = interaction.options.getSubcommand();
		switch (subCommand) {
			case 'update-slash-commands': {
				await interaction.deferReply();
				let output = await run('node', ['deploy-commands.js']);
				if (!output) {
					output = 'Error: No output';
				}
				return global.messageReply(interaction, `\`\`\`${output}\`\`\``);
			}
			case 'reload-slash-commands': {
				console.log(`Bot reload slash commands requested by ${getNameFromMessage(interaction)}`);
				await global.messageReply(interaction, 'Reloading slash command files...');
				setTimeout(global.loadSlashCommands, 10);
				break;
			}
			case 'reload-api': {
				console.log(`Bot reload API server requested by ${getNameFromMessage(interaction)}`);
				await global.messageReply(interaction, 'Restarting API server...');
				await global.startAPIServer();
				break;
			}
			case 'git-project': {
				let name = interaction.options.getString('name', true);
				let action = interaction.options.getString('action', true);

				let config = JSON.parse(fs.readFileSync(global.config.deployProjectConfig, 'utf8'));
				if (!config.projects || !config.projects[name]) {
					return global.messageReply(interaction, `Invalid project name`);
				}

				await interaction.deferReply();
				let output = await run('sudo', [
					global.config.deployProjectScript,
					name,
					action,
					'--config', global.config.deployProjectConfig]);
				if (!output) {
					output = 'Error: No output';
				}
				return global.messageReply(interaction, `\`\`\`${output}\`\`\``);
			}
			case 'reload-config': {
				return global.messageReply(interaction, 'Not implemented...');
			}
			case 'restart': {
				console.log(`Bot quit requested by ${getNameFromMessage(interaction)}`);
				await global.messageReply(interaction, 'Exiting process...');
				interaction.client.destroy();
				process.exit();
				break;
			}
		}
	},
};
