/* jshint esversion: 8 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('who')
		.setDescription('Get information about a member')
		.addUserOption(option => option.setName('user').setDescription('User').setRequired(true)),
	help: true,
	async execute(interaction, member, perm, permName) {
		if (perm < global.PERM_MEMBER) {
			return interaction.reply('You do not have permissions to use this command.');
		}
		await interaction.deferReply({ ephemeral: true });
		
		let targetMember = interaction.options.getMember('user');
		const userData = await global.getForumInfoForMember(targetMember);
		const memberRole = interaction.guild.roles.cache.find(r => { return r.name == global.config.memberRole; });
		
		let embed = {
			description: `**Information for ${targetMember}**`,
			thumbnail: { url: targetMember.displayAvatarURL({extension: 'png'}) },
			fields: []
		}
		
		embed.fields.push({
			name: 'Discord User',
			value: `${targetMember.user.username} (${targetMember.id})`
		});
		
		if (!userData || userData.length == 0) {
			embed.fields.push({
				name: 'Forum Data',
				value: 'User is not registered on the forums.'
			});
		} else {
			for (let i = 0; i < userData.length; i++) {
				let data = userData[i];
				embed.fields.push({
					name: 'Forum Data',
					value: 
						`**Username**: ${data.name} (${data.id})\n` +
						`**Division**: ${data.division}\n` +
						`**Rank**: ${data.rank}\n` +
						`**Status**: ${data.loaStatus}\n`
				});
				if (targetMember.roles.cache.find(r => r.name === global.config.memberRole)) {
					embed.fields.push({
						name: 'Tracker Link',
						value: `${global.config.trackerURL}/members/${data.id}`
					});
				}
			}
		}
		if (targetMember.voice.channel) {
			embed.fields.push({
				name: 'Voice Channel',
				value: `${targetMember.voice.channel}`
			});
		}

		embed.fields.push({
			name: 'Roles',
			value: targetMember.roles.cache
				.filter(r => r != interaction.guild.roles.everyone)
				.sort((r1,r2) => r2.position - r1.position)
				.map(r => `${r}`)
				.join(', ')
		});

		interaction.replied = true; //avoid common reply
		return interaction.editReply({ embeds: [embed], ephemeral: true });
	},
};
