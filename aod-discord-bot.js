#!/bin/node

/**
 * ClanAOD.net discord integration bot
 * 
 * Author: Adam Schultz <archangel122184@gmail.com>
 */

/* jshint esversion: 11 */

//include esm-hook to adapt ESM to commonjs
require("esm-hook");

//include discord.js
const {
	Client,
	GatewayIntentBits,
	Partials,
	ChannelType,
	PermissionsBitField,
	Collection,
	InteractionType
} = require('discord.js');

//include node-fetch using esm-hook
const fetch = require('node-fetch').default;

//include entities
const htmlEntitiesDecode = require('html-entities').decode;

//include sprintf-js
const sprintf = require('sprintf-js').sprintf;
//const vsprintf = require('sprintf-js').vsprintf;

//include config
var config = require('./aod-discord-bot.config.json');
global.config = config;

//inclue fs
const fs = require('node:fs');

//include md5
var md5 = require('md5');

//include https
const https = require('node:https');

//include AOD group config
var forumIntegrationConfig;
try {
	forumIntegrationConfig = require(config.forumGroupConfig);
} catch (error) {
	console.log(error);
	forumIntegrationConfig = {};
}

//include saved timers
var savedTimers;
try {
	savedTimers = require(config.savedTimers);
} catch (error) {
	console.log(error);
	savedTimers = [];
}

//include managedRoles
var managedRoles;
try {
	managedRoles = require(config.managedRoles);
} catch (error) {
	console.log(error);
	managedRoles = { subscribable: {}, assignable: {}, menuOrder: [] };
}

//include dependentRoles
var dependentRoles;
try {
	dependentRoles = require(config.dependentRoles);
} catch (error) {
	console.log(error);
	dependentRoles = { requires: {}, requiredFor: {} };
}

//include relayedMessageMap
var relayedMessageMap;
try {
	relayedMessageMap = require(config.relayedMessageMap);
} catch (error) {
	console.log(error);
	relayedMessageMap = {};
}

//include joinToCreateChannels
var joinToCreateChannels;
try {
	joinToCreateChannels = require(config.joinToCreateChannels);
} catch (error) {
	console.log(error);
	joinToCreateChannels = { joinToCreateChannels: {}, tempChannels: {} };
}

//permission levels
const PERM_OWNER = 8;
const PERM_ADMIN = 7;
const PERM_STAFF = 6;
const PERM_DIVISION_COMMANDER = 5;
const PERM_MOD = 4;
const PERM_RECRUITER = 3;
const PERM_MEMBER = 2;
const PERM_GUEST = 1;
const PERM_NONE = 0;

global.PERM_OWNER = PERM_OWNER;
global.PERM_ADMIN = PERM_ADMIN;
global.PERM_STAFF = PERM_STAFF;
global.PERM_DIVISION_COMMANDER = PERM_DIVISION_COMMANDER;
global.PERM_MOD = PERM_MOD;
global.PERM_RECRUITER = PERM_RECRUITER;
global.PERM_MEMBER = PERM_MEMBER;
global.PERM_GUEST = PERM_GUEST;
global.PERM_NONE = PERM_NONE;

//global undefined for readable code
var undefined;

//other globals
global.lastForumSync = null;

const client = new Client({
	intents: [
		GatewayIntentBits.DirectMessageReactions,
		GatewayIntentBits.DirectMessageTyping,
		GatewayIntentBits.DirectMessages,
		GatewayIntentBits.GuildBans,
		GatewayIntentBits.GuildEmojisAndStickers,
		GatewayIntentBits.GuildIntegrations,
		GatewayIntentBits.GuildInvites,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildMessageReactions,
		GatewayIntentBits.GuildMessageTyping,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildPresences,
		GatewayIntentBits.GuildScheduledEvents,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.GuildWebhooks,
		GatewayIntentBits.Guilds,
		GatewayIntentBits.MessageContent],
	partials: [
		Partials.Message,
		Partials.Channel]
});
global.client = client;

/*************************************
	Utility Functions
 *************************************/

var rolesByForumGroup = null;

function getRolesByForumGroup(guild, doUpdate) {
	if (!doUpdate && rolesByForumGroup !== null)
		return rolesByForumGroup;

	rolesByForumGroup = {};

	Object.keys(forumIntegrationConfig).forEach(roleName => {
		var groupMap = forumIntegrationConfig[roleName];
		var role;
		if (groupMap.roleID === undefined) {
			const role = guild.roles.cache.find(r => { return r.name == roleName; });
			if (role)
				groupMap.roleID = role.id;
		} else
			role = guild.roles.resolve(groupMap.roleID);
		if (role) {
			for (var i in groupMap.forumGroups) {
				var group = groupMap.forumGroups[i];
				if (rolesByForumGroup[group] === undefined)
					rolesByForumGroup[group] = {};
				if (rolesByForumGroup[group][roleName] === undefined)
					rolesByForumGroup[group][roleName] = role;
			}
		}
	});
	return rolesByForumGroup;
}

//initialize and return the mysql database connection 
var mysql = require('mysql2');
var mysqlConnection = null;

function connectToDB() {
	if (mysqlConnection !== null && mysqlConnection.state !== 'disconnected')
		return mysqlConnection;
	mysqlConnection = mysql.createConnection(config.mysql);
	mysqlConnection.connect(error => {
		if (error)
			notifyRequestError(null, null, guild, error, false);
	});
	mysqlConnection
		.on('close', error => {
			if (error) {
				notifyRequestError(null, null, guild, error, false);
				connectToDB();
			}
		})
		.on('error', error => {
			notifyRequestError(null, null, guild, error, false);
			if (error.code === 'PROTOCOL_CONNECTION_LOST')
				connectToDB();
		});
	return mysqlConnection;
}

//get a name to use for logging purposes
function getNameFromMessage(message) {
	if (message) {
		if (message.member)
			return `${message.member.displayName} (${message.member.user.tag})`;
		if (message.author)
			return message.author.tag;
	}
	return "<unknown>";
}
global.getNameFromMessage = getNameFromMessage;

//get the guild member object from the message
function getMemberFromMessageOrArgs(guild, message, args) {
	var member;
	if (message.mentions && message.mentions.members)
		member = message.mentions.members.first();
	if (!member) {
		if (args.length > 0) {
			member = guild.members.resolve(args[0]);
			if (!member) {
				let tag = args[0];
				member = guild.members.cache.find(m => { return m.user.tag === tag; });
			}
		}
	}
	return member;
}

function getChannelFromMessageOrArgs(guild, message, args) {
	var channel;
	if (message.mentions && message.mentions.channels)
		channel = message.mentions.channels.first();
	if (!channel) {
		if (args.length > 0) {
			channel = guild.channels.resolve(args[0]);
			if (!channel) {
				let name = args[0];
				channel = guild.channels.cache.find(c => { return c.name === name; });
			}
		}
	}
	return channel;
}

function sendInteractionReply(interaction, data) {
	if (interaction.replied)
		return interaction.followUp(data);
	else if (interaction.deferred)
		return interaction.editReply(data);
	else
		return interaction.reply(data);
}
global.sendInteractionReply = sendInteractionReply;

function ephemeralReply(message, msg) {
	if (message) {
		if (message.isInteraction) {
			if (typeof(msg) === 'object')
				return sendInteractionReply(message, { embeds: [msg], ephemeral: true });
			else
				return sendInteractionReply(message, { content: msg, ephemeral: true });
		} else {
			if (typeof(msg) === 'object')
				return message.reply(message, { embeds: [msg] });
			else
				return message.reply(msg);
		}
	}
	return Promise.resolve();
}
global.ephemeralReply = ephemeralReply;

function messageReply(message, msg) {
	if (message) {
		if (message.isInteraction)
			return sendInteractionReply(message, msg);
		else
			return message.reply(msg);
	}
	return Promise.resolve();
}

//add or remove a role from a guildMember
async function addRemoveRole(message, guild, add, roleData, member, assigned) {
	let role;
	if (typeof(roleData) === 'object') {
		role = roleData;
	} else {
		role = guild.roles.resolve(roleData);
		if (!role) {
			role = guild.roles.cache.find(r => { return r.name == roleData; });
		}
	}

	if (!role)
		return ephemeralReply(message, "Invalid Role");
	if (!member)
		return ephemeralReply(message, "Please mention a valid member of this server");

	let promise = new Promise(function(resolve, reject) {
		if (add)
			member.roles.add(role, (message ? `Requested by ${getNameFromMessage(message)}` : 'Automated action'))
			.then(async function() {
				if (assigned === true)
					await messageReply(message, `Added ${role.name} to ${member}`);
				else
					await ephemeralReply(message, `Added ${role.name} to ${member}`);
				resolve();
			})
			.catch(error => {
				notifyRequestError(null, null, guild, error, false);
				resolve();
			});
		else
			member.roles.remove(role, (message ? `Requested by ${getNameFromMessage(message)}` : 'Automated action'))
			.then(async function() {
				if (assigned === true)
					await messageReply(message, `Removed ${role.name} from ${member}`);
				else
					await ephemeralReply(message, `Removed ${role.name} from ${member}`);
				resolve();
			})
			.catch(error => {
				notifyRequestError(null, null, guild, error, false);
				resolve();
			});
	});
	return promise;
}
global.addRemoveRole = addRemoveRole;

function getStringForPermission(perm) {
	switch (perm) {
		case PERM_OWNER:
		case PERM_ADMIN:
			return 'Admin';
		case PERM_STAFF:
			return 'Staff';
		case PERM_DIVISION_COMMANDER:
			return 'Division Commander';
		case PERM_MOD:
			return 'Moderator';
		case PERM_RECRUITER:
			return 'Recruiter';
		case PERM_MEMBER:
			return 'Member';
		case PERM_GUEST:
			return 'Guest';
		default:
			return 'Everyone';
	}
}

//map roles to permissions based on config
function getPermissionLevelForMember(member) {
	let perm = PERM_GUEST;
	if (member.permissions.bitfield & BigInt(0x00000008))
		perm = PERM_OWNER;
	else {
		//FIXME very inefficient
		if (member.roles.cache.find(r => config.adminRoles.includes(r.name)))
			perm = PERM_ADMIN;
		else if (member.roles.cache.find(r => config.staffRoles.includes(r.name)))
			perm = PERM_STAFF;
		else if (member.roles.cache.find(r => config.divisionCommandRoles.includes(r.name)))
			perm = PERM_DIVISION_COMMANDER;
		else if (member.roles.cache.find(r => config.modRoles.includes(r.name)))
			perm = PERM_MOD;
		else if (member.roles.cache.find(r => r.name.endsWith('Officer')) ||
			member.roles.cache.find(r => config.recruiterRoles.includes(r.name)))
			perm = PERM_RECRUITER;
		else if (member.roles.cache.find(r => r.name == config.memberRole))
			perm = PERM_MEMBER;
		else if (member.roles.cache.find(r => r.name == config.guestRole))
			perm = PERM_GUEST;
	}
	return [perm, getStringForPermission(perm)];
}
global.getPermissionLevelForMember = getPermissionLevelForMember;

//add view to the permissions list of a role in the server
function addRoleToPermissions(guild, role, permissions, allow, deny) {
	if (!role)
		return permissions;

	permissions.push({
		type: 'role',
		id: role.id,
		allow: (Array.isArray(allow) ? allow : [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect]),
		deny: (Array.isArray(deny) ? deny : []),
	});

	return permissions;
}

function addMemberToPermissions(guild, member, permissions, allow, deny) {
	if (!member)
		return permissions;

	permissions.push({
		type: 'member',
		id: member.id,
		allow: (Array.isArray(allow) ? allow : [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect]),
		deny: (Array.isArray(deny) ? deny : []),
	});

	return permissions;
}

//build a list of permissions for admin
function getPermissionsForAdmin(guild, defaultAllow, defaultDeny, allow, deny) {
	let permissions = [{
		id: guild.id,
		allow: (Array.isArray(defaultAllow) ? defaultAllow : []),
		deny: (Array.isArray(defaultDeny) ? defaultDeny : [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect])
	}];

	const muteRole = guild.roles.cache.find(r => { return r.name == config.muteRole; });
	permissions = addRoleToPermissions(guild, muteRole, permissions, [], [
		PermissionsBitField.Flags.SendMessages,
		PermissionsBitField.Flags.CreatePublicThreads,
		PermissionsBitField.Flags.CreatePrivateThreads,
		PermissionsBitField.Flags.SendMessagesInThreads,
		PermissionsBitField.Flags.SendTTSMessages,
		PermissionsBitField.Flags.Speak,
		PermissionsBitField.Flags.RequestToSpeak,
		PermissionsBitField.Flags.AddReactions,
		PermissionsBitField.Flags.UseExternalEmojis,
		PermissionsBitField.Flags.UseVAD]);
	const pttRole = guild.roles.cache.find(r => { return r.name == config.pttRole; });
	permissions = addRoleToPermissions(guild, pttRole, permissions, [], [PermissionsBitField.Flags.UseVAD]);

	// add admin
	config.adminRoles.forEach(n => {
		const role = guild.roles.cache.find(r => { return r.name == n; });
		if (role)
			permissions = addRoleToPermissions(guild, role, permissions, allow, deny);
	});

	const restrictedBotRole = guild.roles.cache.find(r => { return r.name == "Restricted Bot"; });
	permissions = addRoleToPermissions(guild, restrictedBotRole, permissions, [], [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect]);

	return permissions;
}
//build a list of permissions for staff+
function getPermissionsForStaff(guild, defaultAllow, defaultDeny, allow, deny) {
	let permissions = getPermissionsForAdmin(guild, defaultAllow, defaultDeny, allow, deny);
	// add staff
	config.staffRoles.forEach(n => {
		const role = guild.roles.cache.find(r => { return r.name == n; });
		permissions = addRoleToPermissions(guild, role, permissions, allow, deny);
	});
	return permissions;
}
//build a list of permissions for mod+
function getPermissionsForModerators(guild, defaultAllow, defaultDeny, allow, deny) {
	let permissions = getPermissionsForStaff(guild, defaultAllow, defaultDeny, allow, deny);
	// add moderators
	config.modRoles.forEach(n => {
		const role = guild.roles.cache.find(r => { return r.name == n; });
		if (role)
			permissions = addRoleToPermissions(guild, role, permissions, allow, deny);
	});
	return permissions;
}
//build a list of permissions for member+
function getPermissionsForMembers(guild, defaultAllow, defaultDeny, allow, deny) {
	let permissions = getPermissionsForModerators(guild, defaultAllow, defaultDeny, allow, deny);
	const memberRole = guild.roles.cache.find(r => { return r.name == config.memberRole; });
	return addRoleToPermissions(guild, memberRole, permissions, allow, deny);
}
//build a list of permissions for guest+
function getPermissionsForGuest(guild, defaultAllow, defaultDeny, allow, deny) {
	let permissions = getPermissionsForMembers(guild, defaultAllow, defaultDeny, allow, deny);
	const guestRole = guild.roles.cache.find(r => { return r.name == config.guestRole; });
	return addRoleToPermissions(guild, guestRole, permissions, allow, deny);
}
//build a list of permissions for everyone
function getPermissionsForEveryone(guild, defaultAllow, defaultDeny, allow, deny) {
	let permissions = getPermissionsForGuest(guild, defaultAllow, defaultDeny, allow, deny);
	return permissions;
}

/*************************************
	Saved Timers
 *************************************/

var startNextSavedTimer;
var nextSavedTimer = null;
var nextSavedTimerEpoch = null;

function savedTimerExpired() {
	nextSavedTimer = null;
	nextSavedTimerEpoch = null;

	if (!savedTimers)
		return;

	const guild = client.guilds.resolve(config.guildId);
	let doSave = false;

	while (savedTimers.length > 0) {
		let currEpoch = (new Date()).getTime();
		let firstTimer = savedTimers[0];

		if (currEpoch < firstTimer.epoch)
			break;
		savedTimers.shift();
		doSave = true;

		try {
			switch (firstTimer.type) {
				case 'test': {
					const member = guild.members.resolve(firstTimer.data.memberID);
					if (member)
						member.send('Your test timer has expired').catch(() => {});
					break;
				}
				case 'reminder': {
					const member = guild.members.resolve(firstTimer.data.memberID);
					if (member)
						member.send(`Reminder: ${firstTimer.data.message}`).catch(() => {});
					break;
				}
				default: {
					console.error(`Unknown timer type: ${firstTimer.type}`);
				}
			}
		} catch (error) {
			console.log(error);
		}
	}

	startNextSavedTimer();
	if (doSave)
		fs.writeFileSync(config.savedTimers, JSON.stringify(savedTimers), 'utf8');
}

startNextSavedTimer = function() {
	if (!savedTimers || savedTimers.length === 0)
		return;
	let firstTimer = savedTimers[0];

	if (nextSavedTimer === null || nextSavedTimerEpoch > firstTimer.epoch) {
		if (nextSavedTimer !== null) {
			clearTimeout(nextSavedTimer);
			nextSavedTimer = null;
		}
		let currEpoch = (new Date()).getTime();
		let delta = firstTimer.epoch - currEpoch;
		if (delta <= 0) {
			savedTimerExpired();
		} else {
			nextSavedTimer = setTimeout(savedTimerExpired, delta);
			nextSavedTimerEpoch = firstTimer.epoch;
		}
	}
};

function addTimer(epoch, type, data) {
	if (savedTimers) {
		let i = 0;
		while (i < savedTimers.length) {
			var timer = savedTimers[i];
			if (epoch < timer.epoch)
				break;
			i++;
		}
		savedTimers.splice(i, 0, {
			epoch: epoch,
			type: type,
			data: data
		});
	} else {
		savedTimers = [];
		savedTmers.push({
			epoch: epoch,
			type: type,
			data: data
		});
	}
	startNextSavedTimer();
	fs.writeFileSync(config.savedTimers, JSON.stringify(savedTimers), 'utf8');
}

function deleteTimer(index) {
	savedTimers.splice(index, 1);
	startNextSavedTimer();
	fs.writeFileSync(config.savedTimers, JSON.stringify(savedTimers), 'utf8');
}

/*************************************
	Command Processing Functions
 *************************************/

//forward declaration of commands in case any of the functions need it
var commands;

//params parsing
var paramsRegEx = /([^\s"'\u201C]+)|"(((\\")|([^"]))*)"|'(((\\')|([^']))*)'|\u201C([^\u201D]*)\u201D/g; //BE CAREFUL OF CAPTURE GROUPS BELOW
const paramsReplaceEscapedSingleRegEx = /\\'/g;
const paramsReplaceExcapedDoubleRegEx = /\\"/g;

var mentionRegEx = /<@([0-9]+)>/;

function filterParam(param) {
	mentionRegEx.lastIndex = 0;
	let match = mentionRegEx.exec(param);
	let str = param;
	if (match != null && match[1])
		str = match[1];
	return str;
}

function getParams(string) {
	paramsRegEx.lastIndex = 0;
	var params = [];
	var match = null;
	do {
		//Each call to exec returns the next regex match as an array
		match = paramsRegEx.exec(string);
		if (match != null) {
			//console.log(match);
			let param;
			if (match[1])
				param = match[1];
			else if (match[2])
				param = match[2].replace(paramsReplaceExcapedDoubleRegEx, '"');
			else if (match[6])
				param = match[6].replace(paramsReplaceEscapedSingleRegEx, "'");
			else if (match[10])
				param = match[10];
			else
				param = match[0];
			params.push(filterParam(param));
		}
	} while (match != null);
	return params;
}

//log and notify of errors processing commands
function notifyRequestError(message, member, guild, error, showError) {
	if (!error)
		return;
	console.error(`Error from ${__caller_function}:${__caller_line}: ${error.toString()}`);
	if (showError && message) {
		if (member)
			member.send('An error occurred while processing your request: ' + message.content + "\n" + error.toString())
			.catch(console.error);
	}
}

function sendMessageToMember(member, data) {
	if (member)
		return member.send(data).catch(() => {});
	return Promise.reject();
}

//send a reply as DM to the author of a message (if available) and return a promise
function sendReplyToMessageAuthor(message, member, data) {
	if (message) {
		if (message.isInteraction) {
			if (typeof data === 'object')
				data.ephemeral = true;
			else
				data = { content: data, ephemeral: true };
			return sendInteractionReply(message, data);
		} else if (member) {
			return sendMessageToMember(member, data);
		}
	}
	return Promise.reject();
}

//send a list of items as DM to the author of a message
async function sendListToMessageAuthor(message, member, guild, title, list, footer, formatter) {
	let embed = {
		title: title,
		description: "",
	};
	if (footer)
		embed.footer = { text: footer };
	for (let desc of list) {
		if (formatter)
			desc = formatter(desc);
		desc += "\n";
		if (embed.description.length + desc.length < 2048) {
			embed.description = embed.description + desc;
		} else {
			await sendReplyToMessageAuthor(message, member, { embeds: [embed] });
			embed = {
				title: `Continued...`,
				description: "",
			};
			if (footer)
				embed.footer = { text: footer };
		}
	}
	if (embed.description.length)
		return sendReplyToMessageAuthor(message, member, { embeds: [embed] });
	return Promise.resolve();
}

//help command processing
function commandHelp(message, member, cmd, args, guild, perm, permName, isDM) {
	let filter;
	let detail = false;
	let footer = "**Note**: Parameters that require spaces must be 'single' or \"double\" quoted.";
	if (args.length) {
		detail = true;
		filter = args.shift();
	}

	if (filter) {
		let commandObj = commands[filter];
		if (commandObj && commandObj.minPermission <= perm) {
			let embed = {
				title: `${filter} details`,
				fields: [],
				footer: { text: footer }
			};
			let commandArgsText = commandObj.args;
			if (Array.isArray(commandArgsText))
				commandArgsText = commandArgsText.join(" ");
			let commandHelpText = commandObj.helpText;
			if (Array.isArray(commandHelpText))
				commandHelpText = commandHelpText.join("\n> ");
			if (commandHelpText !== '')
				embed.fields.push({
					name: `${filter} ${commandArgsText}`,
					value: commandHelpText
				});
			sendReplyToMessageAuthor(message, member, { embeds: [embed] });
		} else {
			sendReplyToMessageAuthor(message, member, "Unknown command.");
		}
	} else {
		let embed = {
			title: `Available Commands`,
			description: `Use \`${config.prefix}help <command>\` to see the details of each command.\n`,
			fields: [],
			footer: { text: footer }
		};
		let commandNames = Object.keys(commands);
		let currentPermName;
		for (let permLevel = 0; permLevel <= perm && permLevel <= PERM_OWNER; permLevel++) {
			let permLevelName = getStringForPermission(permLevel);
			for (const command of commandNames) {
				let commandObj = commands[command];
				if (commandObj.minPermission == permLevel) {
					let line = '> ';
					if (currentPermName !== permLevelName) {
						line = `\nUser Level **${permLevelName}**\n` + line;
						currentPermName = permLevelName;
					}

					let commandArgsText = commandObj.args;
					if (Array.isArray(commandArgsText))
						commandArgsText = commandArgsText.join(" ");
					if (commandObj.dmOnly === true)
						line += "***(DM ONLY)*** ";
					line += `${command} ${commandArgsText}\n`;

					if (embed.description.length + line.length < 2048) {
						embed.description = embed.description + line;
					} else {
						sendReplyToMessageAuthor(message, member, { embeds: [embed] });
						embed = {
							title: `Continued...`,
							description: "",
							fields: [],
							footer: { text: footer }
						};
					}
				}
			}
		}
		if (embed.description.length)
			sendReplyToMessageAuthor(message, member, { embeds: [embed] });
	}
}

//ping command processing
function commandPing(message, member, cmd, args, guild, perm, permName, isDM) {
	if (perm >= PERM_STAFF)
		sendReplyToMessageAuthor(message, member, "Ping?")
		.then(m => {
			let pingTime = sprintf('%.3f', client.ws.ping);
			m.edit(`Pong! Latency is ${m.createdTimestamp - message.createdTimestamp}ms. API Latency is ${pingTime}ms`)
				.catch(error => { notifyRequestError(message, member, guild, error, (perm >= PERM_MOD)); });
		})
		.catch(console.error);
	else
		sendReplyToMessageAuthor(message, member, "Pong!")
		.catch(console.error);
}

//roll command processing
var diceRegEx = /^([0-9]+)?[dD]([0-9]+)$/g; //BE CAREFUL OF CAPTURE GROUPS BELOW
function commandRoll(message, member, cmd, args, guild, perm, permName, isDM) {
	let num = 1;
	let size = 6;
	if (args.length > 0) {
		diceRegEx.lastIndex = 0;
		let sides = args.shift();
		sides.replace(/\s/g, '');
		let match = diceRegEx.exec(sides);
		if (match != null) {
			let param = parseInt(match[1]);
			if (param >= 1 && param <= 20)
				num = param;
			param = parseInt(match[2]);
			if (param >= 1 && param <= 100)
				size = param;
		}
	}
	let reply = `${num}d${size} result: `;
	let total = 0;
	for (let i = 0; i < num; i++) {
		let result = Math.floor(Math.random() * size) + 1;
		total += result;
		if (i > 0)
			reply += ', ';
		reply += result;
	}
	if (num > 0)
		reply += ` (total: ${total})`;
	message.reply(reply);
}

//flip command processing
function commandFlip(message, member, cmd, args, guild, perm, permName, isDM) {
	let result = Math.floor(Math.random() * 2);
	if (result > 0)
		message.reply(`Result: heads`);
	else
		message.reply(`Result: tails`);
}

function commandReminder(message, member, cmd, args, guild, perm, permName, isDM) {
	let num = savedTimers.length;
	let menuOrder = 1;
	let myReminders = [];
	for (let idx = 0; idx < num; idx++) {
		let timer = savedTimers[idx];
		if (timer.type == 'reminder' && timer.data.memberID == member.id) {
			myReminders.push({
				index: idx,
				menuOrder: menuOrder,
				timer: timer
			});
			menuOrder++;
		}
	}

	if (args.length > 0) {
		if (args[0] == 'rem') {
			args.shift();
			if (args.length > 0) {
				let menuOrder = args.shift();
				menuOrder = parseInt(menuOrder);
				if (Number.isInteger(menuOrder) && menuOrder > 0 && menuOrder <= myReminders.length) {
					let reminder = myReminders[menuOrder - 1];
					deleteTimer(reminder.index);
					return sendReplyToMessageAuthor(message, member, `Removed reminder: ${reminder.timer.data.message}`);
				}
			}
			return sendReplyToMessageAuthor(message, member, `Reminder required.`);
		} else {
			if (myReminders.length >= 5)
				return sendReplyToMessageAuthor(message, member, `Max reminders already set.`);
			let seconds = processTimeStr(args[0]);
			if (seconds < 0)
				return message.reply('Timeout required');
			if (seconds < 60 || seconds > 604800)
				return message.reply('Timeout must be > 1 minute and < 7 days');
			args.shift();

			let reminderMessage = args.join(' ');
			let expireEpoch = (new Date()).getTime() + (seconds * 1000); //in ms;
			let timerData = {
				memberID: member.id,
				message: reminderMessage
			};
			addTimer(expireEpoch, 'reminder', timerData);
			return sendReplyToMessageAuthor(message, member, `Reminder set for ${secondsToString(seconds)}.`);
		}
	} else {
		let currEpoch = (new Date()).getTime();
		let myReminderStr = [];
		num = myReminders.length;
		for (let idx = 0; idx < num; idx++) {
			let reminder = myReminders[idx];
			let date = new Date(reminder.timer.epoch);
			let seconds = Math.round((reminder.timer.epoch - currEpoch) / 1000);
			myReminderStr.push(`[${reminder.menuOrder}] ${secondsToString(seconds)}: ${reminder.timer.data.message}`);
		}
		return sendReplyToMessageAuthor(message, member, {
			embeds: [{
				title: 'Current Reminders',
				description: myReminderStr.length ? myReminderStr.join("\n") : 'No Reminders Set'
			}]
		});
	}
}

var loginErrorsByUserID = [];
async function userLogin(message, member, guild, username, password) {
	//check for failed login attempts
	if (loginErrorsByUserID[member.user.id] !== undefined) {
		let currEpochMs = (new Date()).getTime();
		let loginError = loginErrorsByUserID[member.user.id];
		if ((loginError.epochMs + config.forumLoginErrorTimeoutMs) > currEpochMs) {
			if (loginError.count >= config.maxForumLoginAttempts) {
				loginError.epochMs = currEpochMs;
				let minutes = Math.round(config.forumLoginErrorTimeoutMs / 60000);
				console.log(`${member.user.tag} login failed for ${username} (too many attempts)`);
				return sendReplyToMessageAuthor(message, member, `You have too many failed login attempts. Please wait ${minutes} minutes and try again.`);
			}
		} else {
			//console.log(`deleting error for ${member.user.tag}`);
			delete loginErrorsByUserID[member.user.id];
		}
	}

	var promise = new Promise(function(resolve, reject) {
		let db = connectToDB();
		let password_md5 = db.escape(md5(password));
		let esc_username = db.escape(username);
		let query = `CALL check_user(${esc_username},${password_md5})`;
		db.query(query, async function(err, rows, fields) {
			var success = false;
			if (!err) {
				//rows[i].userid
				//rows[i].username
				//rows[i].valid
				//should never be more than 1 user...
				if (rows && rows.length && rows[0][0]) {
					let data = rows[0][0];
					if (data && data.valid == 1) {
						success = true;
						let tag = db.escape(convertDiscordTag(member.user.tag));
						let discordId = db.escape(member.user.id);
						let query2 =
							`SELECT u.userid,u.username FROM ${config.mysql.prefix}userfield f ` +
							`INNER JOIN ${config.mysql.prefix}user u ON f.userid=u.userid ` +
							`WHERE (f.field19=${tag} OR f.field20=${discordId}) AND f.userid!=${data.userid}`;
						db.query(query2, async function(err, rows2, fields) {
							if (rows2 && rows2.length) {
								let data2 = rows2[0];
								const sgtsChannel = guild.channels.cache.find(c => { return c.name === 'aod-sergeants'; });
								console.log(`Existing forum account found ${data2.username} ${data2.userid}`);
								if (sgtsChannel) {
									await sgtsChannel.send(`${member.user.tag} logged in as ${data.username} but was already known as ${data2.username}`).catch(() => {});
								}
								query2 = `UPDATE ${config.mysql.prefix}userfield SET field19='',field20='' WHERE userid=${data2.userid}`;
								db.query(query2);
							}
						});

						query2 = `UPDATE ${config.mysql.prefix}userfield SET field19=${tag},field20=${discordId} WHERE userid=${data.userid}`;
						db.query(query2, async function(err, rows2, fields) {
							if (err) {
								await sendReplyToMessageAuthor(message, member, `Successfully logged in as ${data.username} (${data.userid}), but there was an error updating your user infomation.`);
								console.log(err);
								return reject(err);
							}
							console.log(`${member.user.tag} logged in as ${data.username} (${data.userid})`);
							let msg = `Successfully logged in as ${data.username} (${data.userid}).`;
							if (!message.isInteraction && !message.channel.isDMBased())
								msg += ` We recommend you delete the \`${config.prefix}login\` message from your history to protect your identity.`;
							await sendReplyToMessageAuthor(message, member, msg);
							await setRolesForMember(member, "Forum login");
							return resolve();
						});
					}
				}
			}
			if (!success) {
				//track login errors
				if (loginErrorsByUserID[member.user.id] === undefined)
					loginErrorsByUserID[member.user.id] = { epochMs: 0, count: 0 };
				loginErrorsByUserID[member.user.id].epochMs = (new Date()).getTime();
				loginErrorsByUserID[member.user.id].count++;

				console.log(`${member.user.tag} login failed for ${username} (count: ${loginErrorsByUserID[member.user.id].count})`);
				await sendReplyToMessageAuthor(message, member, `Login failed for ${username}.`);
				return reject();
			}
		});
	});
	return promise;
}
global.userLogin = userLogin;

//login command processing
async function commandLogin(message, member, cmd, args, guild, perm, permName, isDM) {
	if (!isDM) {
		message.delete();
		sendMessageToMember(member, `***WARNING:*** You have entered your credentials into a public channel. Your password may be compromised. Please change your password immediately.`);
	}

	if (args.length < 2)
		return sendMessageToMember(member, "Username and Password must be provided.");

	var username = args.shift();
	var password = args.shift();

	return userLogin(message, member, guild, username, password);
}

//aod command processing
function commandSetAOD(message, member, cmd, args, guild, perm, permName, isDM) {
	return addRemoveRole(message, guild, cmd === 'addaod', config.memberRole, getMemberFromMessageOrArgs(guild, message, args), true);
}

//guest command processing
function commandSetGuest(message, member, cmd, args, guild, perm, permName, isDM) {
	return addRemoveRole(message, guild, cmd === 'addguest', config.guestRole, getMemberFromMessageOrArgs(guild, message, args), true);
}

//purge command processing
function commandPurge(message, member, cmd, args, guild, perm, permName, isDM) {
	if (isDM)
		return message.reply("Must be executed in a text channel");

	var deleteCount = parseInt(args[0], 10);

	if (!deleteCount || deleteCount < 1 || deleteCount > 100)
		return message.reply("Please provide a number between 1 and 100 for the number of messages to delete");
	deleteCount++; //remove the request to purge as well

	message.channel.messages.fetch({ limit: deleteCount })
		.then(fetched => message.channel.bulkDelete(fetched)
			.catch(error => message.reply(`Couldn't delete messages because of: ${error}`)))
		.catch(error => message.reply(`Couldn't delete messages because of: ${error}`));
}

var channelPermissionLevels = ['feed', 'guest', 'member', 'role', 'officer', 'mod', 'staff', 'admin'];
var FlagSetVoiceChannelStatus = 1n << 48n; //FIXME Replace with officiel flag

async function getChannelPermissions(guild, message, perm, level, type, divisionOfficerRole, additionalRole, targetMember) {
	let promise = new Promise(async function(resolve, reject) {
		//@everyone permissions
		let defaultAllow = [];
		let defaultDeny = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect];
		//default role permissions
		let allow = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect];
		let deny = [];
		if (type === 'ptt')
			defaultDeny.push(PermissionsBitField.Flags.UseVAD);

		var permissions;
		switch (level) {
			case 'public':
				if (type === 'ptt')
					defaultDeny = [PermissionsBitField.Flags.UseVAD];
				else
					defaultDeny = [];
				if (perm < PERM_MOD) {
					await ephemeralReply(message, "You don't have permissions to add this channel type");
					resolve(null);
					return;
				}

				permissions = getPermissionsForEveryone(guild, defaultAllow, defaultDeny, allow, deny);
				//add role permissions if necessary
				if (divisionOfficerRole) {
					let officerAllow = allow.concat([PermissionsBitField.Flags.ManageMessages, FlagSetVoiceChannelStatus]);
					permissions = addRoleToPermissions(guild, divisionOfficerRole, permissions, officerAllow, deny);
				}
				if (targetMember) {
					let memberAllow = allow.concat([FlagSetVoiceChannelStatus]);
					permissions = addMemberToPermissions(guild, targetMember, permissions, memberAllow, deny);
				}
				break;
			case 'guest':
				if (perm < PERM_MOD) {
					await ephemeralReply(message, "You don't have permissions to add this channel type");
					resolve(null);
					return;
				}

				permissions = getPermissionsForGuest(guild, defaultAllow, defaultDeny, allow, deny);
				//add role permissions if necessary
				if (divisionOfficerRole) {
					let officerAllow = allow.concat([PermissionsBitField.Flags.ManageMessages, FlagSetVoiceChannelStatus]);
					permissions = addRoleToPermissions(guild, divisionOfficerRole, permissions, officerAllow, deny);
				}
				if (targetMember) {
					let memberAllow = allow.concat([FlagSetVoiceChannelStatus]);
					permissions = addMemberToPermissions(guild, targetMember, permissions, memberAllow, deny);
				}
				break;
			case 'mod':
				if (perm < PERM_MOD) {
					await ephemeralReply(message, "You don't have permissions to add this channel type");
					resolve(null);
					return;
				}
				permissions = getPermissionsForModerators(guild, defaultAllow, defaultDeny, allow, deny);
				break;
			case 'officer':
				if (perm < PERM_MOD) {
					await ephemeralReply(message, "You don't have permissions to add this channel type");
					resolve(null);
					return;
				}
				if (!divisionOfficerRole) {
					await ephemeralReply(message, "No officer role could be determined");
					resolve(null);
					return;
				}
				permissions = getPermissionsForModerators(guild, defaultAllow, defaultDeny, allow, deny);
				permissions = addRoleToPermissions(guild, divisionOfficerRole, permissions, [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect]);
				break;
			case 'staff':
				if (perm < PERM_STAFF) {
					await ephemeralReply(message, "You don't have permissions to add this channel type");
					resolve(null);
					return;
				}
				permissions = getPermissionsForStaff(guild, defaultAllow, defaultDeny, allow, deny);
				break;
			case 'admin':
				if (perm < PERM_ADMIN) {
					await ephemeralReply(message, "You don't have permissions to add this channel type");
					resolve(null);
					return;
				}
				permissions = getPermissionsForAdmin(guild, defaultAllow, defaultDeny, allow, deny);
				break;
			case 'feed':
				defaultDeny = [PermissionsBitField.Flags.SendMessages];
				if (type !== 'text') {
					await ephemeralReply(message, "Feed may only be used for text channels");
					resolve(null);
					return;
				}
				if (perm < PERM_DIVISION_COMMANDER) {
					await ephemeralReply(message, "You don't have permissions to add this channel type");
					resolve(null);
					return;
				}
				//get permissions for staff -- add manage webhooks
				let staffAllow = allow.concat([PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageWebhooks]);
				permissions = getPermissionsForStaff(guild, defaultAllow, defaultDeny, staffAllow, deny);
				//add moderators
				let modAllow = allow.concat([PermissionsBitField.Flags.SendMessages]);
				config.modRoles.forEach(n => {
					const role = guild.roles.cache.find(r => { return r.name == n; });
					if (role)
						permissions = addRoleToPermissions(guild, role, permissions, modAllow, deny);
				});
				//add role permissions if necessary
				if (divisionOfficerRole) {
					let officerAllow = allow.concat([PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages]);
					permissions = addRoleToPermissions(guild, divisionOfficerRole, permissions, officerAllow, deny);
				}
				break;
			case 'role':
				if (perm < PERM_DIVISION_COMMANDER) {
					await ephemeralReply(message, "You don't have permissions to add this channel type");
					resolve(null);
					return;
				}
				permissions = getPermissionsForModerators(guild, defaultAllow, defaultDeny, allow, deny);
				if (divisionOfficerRole)
					permissions = addRoleToPermissions(guild, divisionOfficerRole, permissions, allow, deny);
				if (additionalRole)
					permissions = addRoleToPermissions(guild, additionalRole, permissions, allow, deny);
				break;
			default: //member
				permissions = getPermissionsForMembers(guild, defaultAllow, defaultDeny, allow, deny);
				//add role permissions if necessary
				if (divisionOfficerRole) {
					let officerAllow = allow.concat([PermissionsBitField.Flags.ManageMessages, FlagSetVoiceChannelStatus]);
					permissions = addRoleToPermissions(guild, divisionOfficerRole, permissions, officerAllow, deny);
				}
				if (targetMember) {
					let memberAllow = allow.concat([FlagSetVoiceChannelStatus]);
					permissions = addMemberToPermissions(guild, targetMember, permissions, memberAllow, deny);
				}
				break;
		}
		resolve(permissions);
	});
	return promise;
}

async function addChannel(guild, message, member, perm, name, type, level, category, officerRole, role, targetMember) {
	//get channel permissions
	let permissions = await getChannelPermissions(guild, message, perm, level, type, officerRole, role, targetMember);
	if (!permissions) {
		let err = 'Failed to get permissions for channel';
		ephemeralReply(message, err);
		return Promise.reject(err);
	}

	let channelType = ChannelType.GuildText;
	if (type === 'voice') {
		channelType = ChannelType.GuildVoice;
	} else if (type === 'ptt') {
		channelType = ChannelType.GuildVoice;
	} else if (type === 'jtc') {
		channelType = ChannelType.GuildVoice;
	}

	//create channel
	let promise = new Promise(function(resolve, reject) {
		guild.channels.create({
				type: channelType,
				name: name,
				parent: category,
				permissionOverwrites: permissions,
				bitrate: 96000,
				reason: `Requested by ${getNameFromMessage(message)}`
			})
			.then(async (c) => {
				if (channelType === ChannelType.GuildVoice) {
					//make sure someone gets into the channel
					if (category.name == config.tempChannelCategory)
						setTimeout(function() {
							if (c.members.size === 0)
								c.delete()
								.catch(e => {}); //probably removed already
						}, 30000);
					//try to move the person requesting the channel to it
					if (member)
						member.voice.setChannel(c).catch(error => {});
				}
				await ephemeralReply(message, `Added channel ${c.toString()} in ${category.name}`);

				if (type === 'jtc') {
					joinToCreateChannels.joinToCreateChannels[c.id] = 1;
					fs.writeFileSync(config.joinToCreateChannels, JSON.stringify(joinToCreateChannels), 'utf8');
				}

				resolve(c);
			})
			.catch(error => {
				console.log(error);
				let err = 'Failed to create channel';
				ephemeralReply(message, err);
				reject(err);
			});
	});
	return promise;
}
global.addChannel = addChannel;

//voice command processing
async function commandAddChannel(message, member, cmd, args, guild, perm, permName, isDM) {
	let channelCategory;
	let divisionOfficerRole;

	if (args[0] === undefined)
		return message.reply("Invalid parameters");

	let prefix = '';
	if ((channelCategory = guild.channels.cache.find(c => { return (c.name.toLowerCase() == args[0].toLowerCase() && c.type == ChannelType.GuildCategory); }))) {
		//check if this category has an associated officer role
		let roleName = channelCategory.name + ' ' + config.discordOfficerSuffix;
		divisionOfficerRole = guild.roles.cache.find(r => { return r.name == roleName; });

		if (perm < PERM_DIVISION_COMMANDER)
			return message.reply("You may not create a permanent channel");
		if (perm == PERM_DIVISION_COMMANDER && (!divisionOfficerRole || !member.roles.cache.get(divisionOfficerRole.id)))
			return message.reply("You may only add channels to a division you command");
		if (channelCategory.type != ChannelType.GuildCategory)
			return message.reply("Mentioned channel must be a category");
		if (perm < PERM_ADMIN && channelCategory.children.size >= config.maxChannelsPerCategory)
			return message.reply("Category is full");
		args.shift();

		let divisions = await global.getDivisionsFromTracker();
		let divisionData = divisions[channelCategory.name];
		if (divisionData !== undefined) {
			prefix = divisionData.abbreviation;
		} else {
			prefix = channelCategory.name.toLowerCase().replace(/\s/g, '-');
		}
	} else {
		if (cmd === 'text')
			return message.reply("A category must be set for text channels");
		//make sure category exists
		channelCategory = guild.channels.cache.find(c => { return c.name == config.tempChannelCategory; });
		if (!channelCategory)
			return message.reply("Temp channel category not found");
		prefix = channelCategory.name.toLowerCase().replace(/\s/g, '-');
	}

	if (args[0] === undefined)
		return message.reply("Invalid parameters");

	//process level argument if present
	let level = 'member';
	if (channelPermissionLevels.includes(args[0])) {
		level = args[0];
		args.shift();
	}
	let levelRole;
	if (level == 'role') {
		if (args[0] === undefined)
			return message.reply("Role name must be defined");
		let roleName = args[0];
		args.shift();

		levelRole = guild.roles.cache.find(r => { return r.name === roleName; });

		if ((managedRoles.subscribable[roleName] === undefined &&
				managedRoles.assignable[roleName] === undefined) ||
			!levelRole) {
			return message.reply(`Role ${roleName} not a managed role`);
		}
	}

	if (args[0] === undefined)
		return message.reply("Invalid parameters");

	//check for existing channel
	let channelName = args.join(' ').toLowerCase().replace(/\s/g, '-');
	if (channelName === undefined || channelName == '')
		return message.reply("A name must be provided");
	channelName = prefix + '-' + channelName;

	let existingChannel = guild.channels.cache.find(c => { return c.name == channelName; });
	if (existingChannel)
		return message.reply("Channel already exists");

	return addChannel(guild, message, member, perm, channelName, cmd, level, channelCategory, divisionOfficerRole, levelRole);
}

async function setChannelPerms(guild, message, member, perm, channel, type, level, category, officerRole, role) {
	//get channel permissions
	if (channel.isVoiceBased()) {
		if (type !== 'voice' && type !== 'ptt') {
			let everyonePerms = await channel.permissionsFor(guild.roles.everyone);
			if (everyonePerms && !everyonePerms.has(PermissionsBitField.Flags.UseVAD)) {
				type = 'ptt';
			} else {
				type = 'voice';
			}
		}
	} else {
		type = 'text';
	}
	var permissions = await getChannelPermissions(guild, message, perm, level, type, officerRole, role);
	if (!permissions)
		return;

	//replace channel permission overrides
	let promise = new Promise(function(resolve, reject) {
		channel.permissionOverwrites.set(permissions, `Requested by ${getNameFromMessage(message)}`)
			.then(async function() {
				await ephemeralReply(message, `Channel ${channel} permissions updated`);
				resolve();
			})
			.catch(async function(error) {
				await ephemeralReply(message, `Failed to update channel ${channel} permissions`);
				notifyRequestError(message, member, guild, error, (perm >= PERM_MOD));
				reject();
			});
	});
	return promise;
}
global.setChannelPerms = setChannelPerms;

//set channel perms command processing
async function commandSetPerms(message, member, cmd, args, guild, perm, permName, isDM) {
	if (args[0] === undefined)
		return message.reply("Invalid parameters");

	//process level argument if present
	var level = "member";
	if (channelPermissionLevels.includes(args[0])) {
		level = args[0];
		args.shift();
	}
	let levelRole;
	if (level == 'role') {
		if (args[0] === undefined)
			return message.reply("Role name must be defined");
		let roleName = args[0];
		args.shift();

		levelRole = guild.roles.cache.find(r => { return r.name === roleName; });

		if ((managedRoles.subscribable[roleName] === undefined &&
				managedRoles.assignable[roleName] === undefined) ||
			!levelRole) {
			return message.reply(`Role ${roleName} not a managed role`);
		}
	}

	if (args[0] === undefined)
		return message.reply("Invalid parameters");

	//check for existing channel
	let channelName = args.join(' ').toLowerCase().replace(/\s/g, '-');
	if (channelName === undefined || channelName == '')
		return message.reply("A name must be provided");

	if (config.protectedChannels.includes(channelName))
		return message.reply(`${channelName} is a protected channel.`);

	var existingChannel = guild.channels.cache.find(c => { return c.name == channelName; });
	if (!existingChannel || (existingChannel.type !== ChannelType.GuildText && existingChannel.type !== ChannelType.GuildVoice))
		return message.reply("Channel not found");

	//check if we're in a category and get the proper division role
	var divisionCategory = existingChannel.parent;
	var divisionOfficerRole;
	if (divisionCategory) {
		var divisionOfficerRoleName = divisionCategory.name + " " + config.discordOfficerSuffix;
		divisionOfficerRole = guild.roles.cache.find(r => { return r.name === divisionOfficerRoleName; });
	}

	return setChannelPerms(guild, message, member, perm, existingChannel, null, level, divisionCategory, divisionOfficerRole, levelRole);
}

//remove channel command processing
function commandRemChannel(message, member, cmd, args, guild, perm, permName, isDM) {
	//check for existing channel
	let channelName = args.join(' ').toLowerCase().replace(/\s/g, '-');
	if (channelName === undefined || channelName == '')
		return message.reply("A name must be provided");

	if (config.protectedChannels.includes(channelName))
		return message.reply(`${channelName} is a protected channel.`);

	var existingChannel = guild.channels.cache.find(c => { return c.name == channelName; });
	if (!existingChannel || existingChannel.type === ChannelType.GuildCategory)
		return message.reply("Channel not found");

	if (perm < PERM_DIVISION_COMMANDER)
		return message.reply("You may not delete this channel");

	var channelCategory = existingChannel.parent;
	if (channelCategory) {
		//check if this category has an associated officer role
		let officerRoleName = channelCategory.name + ' ' + config.discordOfficerSuffix;
		divisionOfficerRole = guild.roles.cache.find(r => { return r.name == officerRoleName; });
		if (perm == PERM_DIVISION_COMMANDER && (!divisionOfficerRole || !member.roles.cache.get(divisionOfficerRole.id)))
			return message.reply("You may only delete channels from a division you command");
	} else {
		if (perm < PERM_STAFF)
			return message.reply("You may not delete this channel");
	}
	existingChannel.delete(`Requested by ${getNameFromMessage(message)}`)
		.then(() => { message.reply(`Channel ${channelName} removed`); });
}

//rename channel command processing
async function commandRenameChannel(message, member, cmd, args, guild, perm, permName, isDM) {
	if (args.length <= 0)
		return message.reply("A name must be provided");

	let channelName;
	if (args.length == 1) {
		//one argument, rename the channel the command was received in
		if (isDM)
			return message.reply("A new name must be provided");
		channelName = message.channel.name;
	} else {
		channelName = args[0];
		args.shift();
	}
	channelName = channelName.toLowerCase().replace(/\s/g, '-');

	let newName = args[0].toLowerCase().replace(/\s/g, '-');

	if (config.protectedChannels.includes(channelName))
		return message.reply(`${channelName} is a protected channel.`);

	var existingChannel = guild.channels.cache.find(c => { return c.name == channelName; });
	if (!existingChannel || existingChannel.type === ChannelType.GuildCategory)
		return message.reply("Channel not found");

	if (perm < PERM_DIVISION_COMMANDER)
		return message.reply("You may not rename this channel");

	var channelCategory = existingChannel.parent;
	if (channelCategory) {
		//check if this category has an associated officer role
		let roleName = channelCategory.name + ' ' + config.discordOfficerSuffix;
		divisionOfficerRole = guild.roles.cache.find(r => { return r.name == roleName; });
		if (perm == PERM_DIVISION_COMMANDER && (!divisionOfficerRole || !member.roles.cache.get(divisionOfficerRole.id)))
			return message.reply("You may only rename channels from a division you command");

		let prefix;
		let divisions = await global.getDivisionsFromTracker();
		let divisionData = divisions[channelCategory.name];
		if (divisionData !== undefined) {
			prefix = divisionData.abbreviation;
		} else {
			prefix = channelCategory.name.toLowerCase().replace(/\s/g, '-');
		}

		if (!newName.startsWith(prefix)) {
			newName = prefix + '-' + newName;
		}
	} else {
		if (perm < PERM_STAFF)
			return message.reply("You may not rename this channel");
	}
	existingChannel.setName(newName, `Requested by ${getNameFromMessage(message)}`)
		.then(() => { message.reply(`Channel ${channelName} renamed to ${newName}`); });
}

function commandTopic(message, member, cmd, args, guild, perm, permName, isDM) {
	if (args.length <= 0)
		return message.channel.setTopic('', `Requested by ${getNameFromMessage(message)}`);

	let channelName = args[0].toLowerCase();
	if (config.protectedChannels.includes(channelName) && perm < PERM_STAFF)
		return message.reply(`${channelName} is a protected channel.`);

	let channel = guild.channels.cache.find(c => { return (c.name.toLowerCase() == channelName); });
	if (channel)
		args.shift();
	else if (message.channel.type === ChannelType.GuildText)
		channel = message.channel;

	if (channel) {
		if (args.length <= 0) {
			return channel.setTopic('', `Requested by ${getNameFromMessage(message)}`);
		} else {
			channel.setTopic(args.join(' '), `Requested by ${getNameFromMessage(message)}`)
				.catch(error => { notifyRequestError(message, member, guild, error, (perm >= PERM_MOD)); });
		}
	} else {
		return message.reply("Channel not found");
	}
}

//move channel command processing
function commandMoveChannel(message, member, cmd, args, guild, perm, permName, isDM) {
	//check for existing channel
	let channelName = args.join(' ');
	if (channelName === undefined || channelName == '')
		return message.reply("A name must be provided");

	if (config.protectedChannels.includes(channelName))
		return message.reply(`${channelName} is a protected channel.`);

	var existingChannel = guild.channels.cache.find(c => { return c.name == channelName; });
	if (existingChannel)
		existingChannel.setPosition(cmd === 'up' ? -1 : 1, { relative: true, reason: `Requested by ${getNameFromMessage(message)}` })
		.then(() => { message.reply(`Channel ${channelName} moved`); })
		.catch(error => { notifyRequestError(message, member, guild, error, (perm >= PERM_MOD)); });
	else
		return message.reply("Channel not found");
}

/*
//retrieve a webhook directly from the discord API 
// (for some reason discord.js framework doesn't give us token in the Webhook object
function getWebhookFromAPI(webhookID)
{
	var getOptions = {
		method: 'GET',
		url: `https://discordapp.com/api/webhooks/${webhookID}`,
		headers: {
			'User-Agent': 'Discord Bot',
			'Authorization': `Bot ${config.token}`,
			'Content-Type': 'application/json',
		},
		json: true
	};
	process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 1;
	var promise = new Promise(function(resolve, reject)	{
		request(getOptions, function(error, response, body) {
			if (error)
				reject(error);
			if (body.code)
				reject(body);
			resolve(body);	
		});
	});
	return promise;
}
*/

const fetchTimeout = (url, ms, { signal, ...options } = {}) => {
	const controller = new AbortController();
	const promise = fetch(url, { signal: controller.signal, ...options });
	if (signal) signal.addEventListener("abort", () => controller.abort());
	const timeout = setTimeout(() => controller.abort(), ms);
	return promise.finally(() => clearTimeout(timeout));
};

var _divisions;
var _lastDivisionsRefresh;
async function getDivisionsFromTracker() {
	let promise = new Promise(async function(resolve, reject) {
		let now = new Date();
		if (_divisions && ((now - _lastDivisionsRefresh) < (60 * 1000))) {
			//only refresh once per minute
			resolve(_divisions);
		}
		try {
			let response = await fetchTimeout(`${config.trackerAPIURL}/divisions`, 1000, {
				method: 'get',
				headers: {
					'User-Agent': 'Discord Bot',
					'Accept': 'application/json',
					'Authorization': `Bearer ${config.trackerAPIToken}`
				}
			});
			let body = await response.json();
			if (body.data !== undefined) {
				_divisions = {};
				_lastDivisionsRefresh = now;
				let len = body.data.length;
				for (i = 0; i < len; i++) {
					let division = body.data[i];
					_divisions[division.name] = {
						abbreviation: division.abbreviation,
						slug: division.slug,
						forum_app_id: division.forum_app_id,
						officer_channel: division.officer_channel,
						icon: division.icon
					};
				}
			}
			resolve(_divisions);
		} catch (e) {
			console.log(e);
			resolve(_divisions);
		}
	});
	return promise;
}
global.getDivisionsFromTracker = getDivisionsFromTracker;

async function updateTrackerDivisionData(divisionData, data) {
	let promise = new Promise(async function(resolve, reject) {
		let response = await fetchTimeout(`${config.trackerAPIURL}/divisions/${divisionData.slug}`, 1000, {
			method: 'post',
			body: JSON.stringify(data),
			headers: {
				'User-Agent': 'Discord Bot',
				'Content-Type': 'application/json',
				'Accept': 'application/json',
				'Authorization': `Bearer ${config.trackerAPIToken}`
			}
		}).catch(err => {
			console.log(err);
			reject('Failed to update divsision data');
		});
		await response.json(); //wait for content to finish
		resolve();
	});
	return promise;
}

function updateTrackerDivisionOfficerChannel(divisionData, channel) {
	return updateTrackerDivisionData(divisionData, { officer_channel: channel.id })
		.then(function() { divisionData.officer_channel = channel.id; })
		.catch(() => {});
}
global.updateTrackerDivisionOfficerChannel = updateTrackerDivisionOfficerChannel;

async function addDivision(message, member, perm, guild, divisionName) {
	let officerRoleName = divisionName + ' ' + config.discordOfficerSuffix;
	let lcName = divisionName.toLowerCase();
	let simpleName = lcName.replace(/\s/g, '-');

	var divisionCategory = guild.channels.cache.find(c => { return (c.name.toLowerCase() == lcName && c.type == ChannelType.GuildCategory); });
	if (divisionCategory)
		return ephemeralReply(message, "Division category already exists.");
	var divisionOfficerRole = guild.roles.cache.find(r => { return r.name == officerRoleName; });
	if (divisionOfficerRole)
		return ephemeralReply(message, "Division officer role already exists.");

	let prefix = simpleName;
	let divisions = await getDivisionsFromTracker();
	let divisionData = divisions[divisionName];
	if (divisionData === undefined) {
		await ephemeralReply(message, `:warning: ${divisionName} is not defined on the tracker`);
	} else {
		prefix = divisionData.abbreviation;
	}

	let divisionMembersChannel = prefix + '-members';
	let divisionOfficersChannel = prefix + '-officers';
	let divisionPublicChannel = prefix + '-public';
	let divisionMemberVoiceChannel = prefix + '-member-voip';

	try {
		//create officers role
		//divisionOfficerRole = await guild.roles.create({ name: officerRoleName, permissions: 0, mentionable: true, reason: `Requested by ${getNameFromMessage(message)}` });
		divisionOfficerRole = await guild.roles.create({ name: officerRoleName, permissions: [], mentionable: true, reason: `Requested by ${getNameFromMessage(message)}` });
		const memberRole = guild.roles.cache.find(r => { return r.name == config.memberRole; });
		await divisionOfficerRole.setPosition(memberRole.position + 1).catch(e => { console.log(e); });

		//add category for division
		let permissions = await getChannelPermissions(guild, message, perm, 'public', 'text', divisionOfficerRole);
		divisionCategory = await guild.channels.create({
				type: ChannelType.GuildCategory,
				name: divisionName,
				permissionOverwrites: permissions,
				reason: `Requested by ${getNameFromMessage(message)}`
			})
			.catch(e => { console.log(e); });

		//create members channel
		permissions = await getChannelPermissions(guild, message, perm, 'member', 'text', divisionOfficerRole);
		let membersChannel = await guild.channels.create({
				type: ChannelType.GuildText,
				name: divisionMembersChannel,
				parent: divisionCategory,
				permissionOverwrites: permissions,
				reason: `Requested by ${getNameFromMessage(message)}`
			})
			.catch(e => { console.log(e); });

		//create officers channel
		permissions = await getChannelPermissions(guild, message, perm, 'officer', 'text', divisionOfficerRole);
		let officersChannel = await guild.channels.create({
				type: ChannelType.GuildText,
				name: divisionOfficersChannel,
				parent: divisionCategory,
				permissionOverwrites: permissions,
				reason: `Requested by ${getNameFromMessage(message)}`
			})
			.catch(e => { console.log(e); });

		//create public channel
		permissions = await getChannelPermissions(guild, message, perm, 'public', 'text', divisionOfficerRole);
		let publicChannel = await guild.channels.create({
				type: ChannelType.GuildText,
				name: divisionPublicChannel,
				parent: divisionCategory,
				permissionOverwrites: permissions,
				reason: `Requested by ${getNameFromMessage(message)}`
			})
			.catch(e => { console.log(e); });

		//create member voice channel
		permissions = await getChannelPermissions(guild, message, perm, 'member', 'voice', divisionOfficerRole);
		let memberVoipChannel = await guild.channels.create({
				type: ChannelType.GuildVoice,
				name: divisionMemberVoiceChannel,
				parent: divisionCategory,
				permissionOverwrites: permissions,
				reason: `Requested by ${getNameFromMessage(message)}`
			})
			.catch(e => { console.log(e); });

		addForumSyncMap(message, guild, officerRoleName, divisionName + ' ' + config.forumOfficerSuffix);
		if (divisionData)
			updateTrackerDivisionOfficerChannel(divisionData, officersChannel);

		return ephemeralReply(message, `${divisionName} division added`);
	} catch (error) {
		notifyRequestError(message, member, guild, error, (perm >= PERM_MOD));
		return ephemeralReply(message, `Failed to add ${divisionName} division`);
	}
}
global.addDivision = addDivision;

//adddivision command processing
function commandAddDivision(message, member, cmd, args, guild, perm, permName, isDM) {
	let divisionName = args.join(' ');
	if (divisionName === undefined || divisionName == '')
		return ephemeralReply(message, "A name must be provided");
	return addDivision(message, member, perm, guild, divisionName);
}

async function deleteDivision(message, member, perm, guild, divisionName) {
	let officerRoleName = divisionName + ' ' + config.discordOfficerSuffix;

	let divisions = await getDivisionsFromTracker();
	let divisionData = divisions[divisionName];
	if (divisionData === undefined) {
		await ephemeralReply(message, `:warning: ${divisionName} is not defined on the tracker`);
	} else {
		prefix = divisionData.abbreviation;
	}

	const divisionCategory = guild.channels.cache.find(c => { return (c.name == divisionName && c.type === ChannelType.GuildCategory); });
	if (divisionCategory) {
		if (config.protectedCategories.includes(divisionCategory.name))
			return ephemeralReply(message, `${divisionName} is a protected category.`);

		//remove channels in category
		for (let c of divisionCategory.children.cache.values()) {
			try {
				await c.setParent(null, `Requested by ${getNameFromMessage(message)}`);
				await c.delete(`Requested by ${getNameFromMessage(message)}`);
			} catch (error) {
				notifyRequestError(message, member, guild, error, (perm >= PERM_MOD));
			}
		}

		//remove category
		try {
			await divisionCategory.delete(`Requested by ${getNameFromMessage(message)}`);
		} catch (error) {
			notifyRequestError(message, member, guild, error, (perm >= PERM_MOD));
		}

		await ephemeralReply(message, `${divisionName} category removed`);
	} else {
		await ephemeralReply(message, `${divisionName} category not found`);
	}

	const role = guild.roles.cache.find(r => { return r.name == officerRoleName; });
	if (role) {
		try {
			await role.delete(`Requested by ${getNameFromMessage(message)}`);
		} catch (error) {
			notifyRequestError(message, member, guild, error, (perm >= PERM_MOD));
		}
		await ephemeralReply(message, `${officerRoleName} role removed`);
	} else {
		await ephemeralReply(message, `${officerRoleName} role not found`);
	}

	if (forumIntegrationConfig[officerRoleName] !== undefined) {
		delete(forumIntegrationConfig[officerRoleName]);
		fs.writeFileSync(config.forumGroupConfig, JSON.stringify(forumIntegrationConfig), 'utf8');
		getRolesByForumGroup(guild, true);
	}
}
global.deleteDivision = deleteDivision;

//remdivision command processing
async function commandRemDivision(message, member, cmd, args, guild, perm, permName, isDM) {
	let divisionName = args.join(' ');
	if (divisionName === undefined || divisionName == '')
		return message.reply("A name must be provided");
	return deleteDivision(message, member, perm, guild, divisionName);
}

function escapeNameCharacter(ch) {
	return ('\\' + ch);
}

function escapeNameForOutput(name) {
	return name.replace(/[*_]/g, escapeNameCharacter);
}

function escapeDisplayNameForOutput(member) {
	return member.displayName.replace(/[*_]/g, escapeNameCharacter);
}

function listMembers(message, member, guild, roleName) {
	let menuOrder = parseInt(roleName);
	if (Number.isInteger(menuOrder) && menuOrder > 0 && menuOrder <= managedRoles.menuOrder.length) {
		roleName = managedRoles.menuOrder[menuOrder - 1];
	}
	roleName = roleName.toLowerCase();
	let role = guild.roles.cache.find(r => { return r.name.toLowerCase() == roleName; });
	if (role) {
		if (role.members.size > 256) {
			return ephemeralReply(message, `Role ${role.name} has more than 256 members.`);
		}
		return sendListToMessageAuthor(message, member, guild, `Members of ${role.name} (${role.members.size})`,
			role.members.sort((a, b) => a.displayName.localeCompare(b.displayName)).values(), "", escapeDisplayNameForOutput);
	} else {
		return ephemeralReply(message, `Role ${roleName} does not exist`);
	}
}
global.listMembers = listMembers;

async function listRoles(message, member, guild, targetMember, assign) {
	let subedRoles = [];
	let assignedRoles = [];
	let availRoles = [];
	for (let index = 0; index < managedRoles.menuOrder.length; index++) {
		let roleName = managedRoles.menuOrder[index];
		let subConfig;
		let assignConfig;
		if ((subConfig = managedRoles.subscribable[roleName])) {
			if (targetMember.roles.cache.get(subConfig.roleID)) {
				let role = guild.roles.resolve(subConfig.roleID);
				let size = (role ? role.members.size : 0);
				subedRoles.push(`[${subConfig.menuOrder}] ${roleName} (${size} members)`);
			} else if (!assign) {
				availRoles.push(`[${subConfig.menuOrder}] ${roleName}`);
			}
		} else if (assign && (assignConfig = managedRoles.assignable[roleName])) {
			if (targetMember.roles.cache.get(assignConfig.roleID)) {
				let role = guild.roles.resolve(assignConfig.roleID);
				let size = (role ? role.members.size : 0);
				assignedRoles.push(`[${assignConfig.menuOrder}] ${roleName} (${size} members)`);
			} else {
				availRoles.push(`[${assignConfig.menuOrder}] ${roleName}`);
			}
		}
	}
	if (assign) {
		let displayName = escapeDisplayNameForOutput(targetMember);
		await sendListToMessageAuthor(message, member, guild, `Subscribed Roles for ${displayName}`, subedRoles);
		await sendListToMessageAuthor(message, member, guild, `Assigned Roles for ${displayName}`, assignedRoles);
		return sendListToMessageAuthor(message, member, guild, `Available Roles for ${displayName}`, availRoles);
	} else {
		await sendListToMessageAuthor(message, member, guild, `Subscribed Roles`, subedRoles);
		return sendListToMessageAuthor(message, member, guild, `Available Roles`, availRoles);
	}
}
global.listRoles = listRoles;

function getUserRoles(assign, member, hasRole) {
	let config = assign ? managedRoles.assignable : managedRoles.subscribable;
	let roles = Object.keys(config);
	if (!member)
		return roles;
	return roles.filter(r => {
		if (member.roles.cache.get(config[r].roleID))
			return hasRole;
		else
			return !hasRole;
	});
}
global.getUserRoles = getUserRoles;

async function subUnsubRole(message, member, guild, targetMember, assign, sub, roleName) {
	let rolesConfig;
	let otherRolesConfig;
	if (assign) {
		rolesConfig = managedRoles.assignable;
		otherRolesConfig = managedRoles.subscribable;
	} else {
		rolesConfig = managedRoles.subscribable;
		otherRolesConfig = managedRoles.assignable;
	}

	let config = rolesConfig[roleName];
	if (!config && assign && !sub)
		config = otherRolesConfig[roleName];
	if (!config) {
		let menuOrder = parseInt(roleName);
		if (Number.isInteger(menuOrder) && menuOrder > 0 && menuOrder <= managedRoles.menuOrder.length) {
			roleName = managedRoles.menuOrder[menuOrder - 1];
			config = rolesConfig[roleName];
			if (!config && assign && !sub)
				config = otherRolesConfig[roleName];
		}
	}
	if (!config) {
		if (assign)
			return ephemeralReply(message, `Role ${roleName} is not assignable`);
		else
			return ephemeralReply(message, `Role ${roleName} is not subscribable`);
	}
	return addRemoveRole(message, guild, sub, config.roleID, targetMember);
}
global.subUnsubRole = subUnsubRole;

//sub/unsub/list command processing
function commandSub(message, member, cmd, args, guild, perm, permName, isDM) {
	let targetMember = getMemberFromMessageOrArgs(guild, message, args);
	let assign = false;
	if (targetMember) {
		if (perm < PERM_MOD)
			return message.reply("You don't have permissions assign roles.");
		if (args.length > 0)
			args.shift();
		assign = true;
	} else {
		targetMember = member;
	}

	switch (cmd) {
		case 'sub':
		case 'unsub': {
			if (args.length <= 0)
				return ephemeralReply(message, 'Role must be provided');
			let roleName = args.join(' ');
			return subUnsubRole(message, member, guild, targetMember, assign, cmd === 'sub', roleName);
		}
		case 'list': {
			if (args.length) {
				if (perm < PERM_MOD) {
					return ephemeralReply(message, "You don't have permissions to show role members.");
				}
				let roleName = args.join(' ');
				return listMembers(message, member, guild, roleName);
			} else {
				return listRoles(message, member, guild, targetMember, assign);
			}
		}
	}
}

function saveRolesConfigFile() {
	let roles = [];
	for (let roleName in managedRoles.subscribable) {
		if (managedRoles.subscribable.hasOwnProperty(roleName)) {
			roles.push(roleName);
		}
	}
	for (let roleName in managedRoles.assignable) {
		if (managedRoles.assignable.hasOwnProperty(roleName)) {
			if (!roles.includes(roleName))
				roles.push(roleName);
		}
	}
	roles.sort();
	let menuOrder = 1;
	for (let roleName of roles) {
		if (managedRoles.subscribable[roleName] !== undefined)
			managedRoles.subscribable[roleName].menuOrder = menuOrder;
		if (managedRoles.assignable[roleName] !== undefined)
			managedRoles.assignable[roleName].menuOrder = menuOrder;
		menuOrder++;
	}
	managedRoles.menuOrder = roles;
	fs.writeFileSync(config.managedRoles, JSON.stringify(managedRoles), 'utf8');
}

async function doAddManagedRole(message, guild, rolesConfig, otherRolesConfig, roleName, role, isNew) {
	if (rolesConfig[roleName] === undefined) {
		rolesConfig[roleName] = {
			roleID: role.id,
			created: isNew
		};
		if (otherRolesConfig && otherRolesConfig[roleName] !== undefined && otherRolesConfig[roleName].created === true) {
			rolesConfig[roleName].created = true;
		}
		saveRolesConfigFile();
		return ephemeralReply(message, `Role ${roleName} created and added to ${commonString} roles`);
	} else {
		if (rolesConfig[roleName].roleID !== role.id)
			return ephemeralReply(message, `Role ${roleName} already managed, but ID is different`);
		else
			return ephemeralReply(message, `Role ${roleName} already managed`);
	}
}

async function doRemoveManagedRole(message, guild, rolesConfig, otherRolesConfig, roleName) {
	if (rolesConfig[roleName] === undefined) {
		return ephemeralReply(message, `Role ${roleName} is not managed`);
	} else {
		let deleteRole = (rolesConfig[roleName].created && otherRolesConfig[roleName] === undefined);
		let role = guild.roles.resolve(rolesConfig[roleName].roleID);
		delete rolesConfig[roleName];
		saveRolesConfigFile();
		if (deleteRole && role)
			await role.delete(`Requested by ${getNameFromMessage(message)}`);
		return ephemeralReply(message, `Role ${roleName} removed from ${commonString} roles`);
	}
}

function isManageableRole(role) {
	if (role.permissions.bitfield & BigInt(0x00000008))
		return false;
	if (config.adminRoles.includes(role.name))
		return false;
	if (config.staffRoles.includes(role.name))
		return false;
	if (config.divisionCommandRoles.includes(role.name))
		return false;
	if (config.modRoles.includes(role.name))
		return false;
	if (config.recruiterRoles.includes(role.name))
		return false;
	if (role.name.endsWith('Officer'))
		return false;
	if (role.name == config.memberRole)
		return false;
	if (role === role.guild.roles.everyone)
		return false;
	return true;
}
global.isManageableRole = isManageableRole;

async function listManagedRoles(message, member, guild) {
	let subRoles = [];
	let assignRoles = [];
	for (let roleName of new Set(managedRoles.menuOrder)) {
		let config = managedRoles.subscribable[roleName];
		if (config) {
			let role = guild.roles.resolve(config.roleID);
			let size = (role ? role.members.size : 0);
			let createdFlag = (config.created === true ? '*' : '');
			subRoles.push(`${roleName}${createdFlag} (${size} members)`);
		}
		config = managedRoles.assignable[roleName];
		if (config) {
			let role = guild.roles.resolve(config.roleID);
			let size = (role ? role.members.size : 0);
			let createdFlag = (config.created === true ? '*' : '');
			assignRoles.push(`${roleName}${createdFlag} (${size} members)`);
		}
	}
	subRoles.sort();
	assignRoles.sort();

	await sendListToMessageAuthor(message, member, guild, `Subscribable Roles`, subRoles,
		'* indicates roles that would be deleted upon removal');
	return sendListToMessageAuthor(message, member, guild, `Assignable Roles`, assignRoles,
		'* indicates roles that would be deleted upon removal');
}
global.listManagedRoles = listManagedRoles;

async function pruneManagedRoles(message, member, guild) {
	let subRoles = [];
	let assignRoles = [];
	for (let roleName of new Set(managedRoles.menuOrder)) {
		if (managedRoles.subscribable[roleName]) {
			let role = guild.roles.resolve(managedRoles.subscribable[roleName].roleID);
			if (!role) {
				delete managedRoles.subscribable[roleName];
				subRoles.push(roleName);
			}
		}
		if (managedRoles.assignable[roleName]) {
			let role = guild.roles.resolve(managedRoles.assignable[roleName].roleID);
			if (!role) {
				delete managedRoles.assignable[roleName];
				assignRoles.push(roleName);
			}
		}
	}

	subRoles.sort();
	assignRoles.sort();
	if (subRoles.length || assignRoles.length)
		saveRolesConfigFile();
	return sendReplyToMessageAuthor(message, member, {
		embeds: [{
			title: "Roles Pruned",
			fields: [
				{ name: "Subscribable Roles", value: subRoles.length ? subRoles.join("\n") : '*None*' },
				{ name: "Assignable Roles", value: assignRoles.length ? assignRoles.join("\n") : '*None*' }
			]
		}]
	});
}
global.pruneManagedRoles = pruneManagedRoles;

async function addManagedRole(message, member, guild, roleName, create, assign) {
	if (assign) {
		rolesConfig = managedRoles.assignable;
		otherRolesConfig = managedRoles.subscribable;
		commonString = 'assignable';
	} else {
		rolesConfig = managedRoles.subscribable;
		otherRolesConfig = managedRoles.assignable;
		commonString = 'subscribable';
	}

	let role = guild.roles.cache.find(r => { return r.name == roleName; });
	if (role) {
		if (create) {
			return ephemeralReply(message, `Role ${roleName} already exists.`);
		}
		if (!isManageableRole(role)) {
			return ephemeralReply(message, `Role ${roleName} is not manageable`);
		}
	} else if (!role) {
		if (!create) {
			return ephemeralReply(message, `Role ${roleName} not found`);
		}
		try {
			role = await guild.roles.create({ name: roleName, permissions: [], mentionable: true, reason: `Requested by ${getNameFromMessage(message)}` });
		} catch (error) {
			return ephemeralReply(message, `Failed to create Role ${roleName}`);
		}
		roleName = role.name; //in case discord alters
	}

	return doAddManagedRole(message, guild, rolesConfig, null, roleName, role, create);
}
global.addManagedRole = addManagedRole;

async function removeManagedRole(message, member, guild, roleName, assign) {
	if (assign) {
		rolesConfig = managedRoles.assignable;
		otherRolesConfig = managedRoles.subscribable;
		commonString = 'assignable';
	} else {
		rolesConfig = managedRoles.subscribable;
		otherRolesConfig = managedRoles.assignable;
		commonString = 'subscribable';
	}

	return doRemoveManagedRole(message, guild, rolesConfig, otherRolesConfig, roleName);
}
global.removeManagedRole = removeManagedRole;

//subrole command processing
async function commandSubRoles(message, member, cmd, args, guild, perm, permName, isDM) {
	if (args.length <= 0)
		return message.reply('No parameters provided');

	let subcmd = args.shift();
	switch (subcmd) {
		case 'adda':
		case 'add': {
			if (args.length <= 0)
				return message.reply('Role name must be provided');
			let roleName = args.join(' ');
			return addManagedRole(message, member, guild, roleName, false, subcmd === 'adda');
		}
		case 'rema':
		case 'rem': {
			if (args.length <= 0)
				return message.reply('Role name must be provided');
			let roleName = args.join(' ');
			return removeManagedRole(message, member, guild, roleName, subcmd === 'rema');
		}
		case 'createa':
		case 'create': {
			if (args.length <= 0)
				return message.reply('Role name must be provided');
			let roleName = args.join(' ');
			return addManagedRole(message, member, guild, roleName, true, subcmd === 'createa');
		}
		case 'list': {
			return listManagedRoles(message, member, guild);
		}
		case 'prune': {
			return pruneManagedRoles(message, member, guild);
		}
		default: {
			return message.reply(`Unknown command: ${subcmd}`);
		}
	}
}

/*
dependentRoles = {
	requires: {
		roleID1: [ roleID2, roleID3 ]
	}
	requiredFor: {
		roleID2: [ roleID1 ],
		roleID3: [ roleID1 ]
	},
}
*/

function getMemberTag(m) {
	return m.user.tag;
}

function auditDependentRole(guild, dependentRole, requiredRole) {
	//console.log(`Auditing ${dependentRole.name}`);
	let toRemove;
	let toAdd;
	if (requiredRole) {
		//Collection.difference returns elements from both sets; use filter instead
		toRemove = dependentRole.members.filter(m => { return !requiredRole.members.has(m); });
	} else {
		let dependentRoleId = '' + dependentRole.id;
		let sharedMembers;
		if (dependentRoles.requires[dependentRoleId] !== undefined) {
			let requiredRoleIds = dependentRoles.requires[dependentRoleId];
			for (let i = 0; i < requiredRoleIds.length; i++) {
				let requiredRole = guild.roles.resolve(requiredRoleIds[i]);
				if (requiredRole) {
					//console.log(`-- checking ${requiredRole.name}`);
					if (sharedMembers) {
						sharedMembers = requiredRole.members.intersect(sharedMembers);
					} else {
						sharedMembers = requiredRole.members;
					}
				}
			}
		}
		if (sharedMembers) {
			//Collection.difference returns elements from both sets; use filter instead
			toRemove = dependentRole.members.filter(m => { return !sharedMembers.has(m); });
			toAdd = sharedMembers.filter(m => { return !dependentRole.members.has(m); });
			console.log([dependentRole.name, sharedMembers.map(getMemberTag), toRemove.map(getMemberTag), toAdd.map(getMemberTag)]);
		}
	}
	if (toRemove) {
		toRemove.each(m => {
			m.roles.remove(dependentRole);
		});
	}
	if (toAdd) {
		toAdd.each(m => {
			m.roles.add(dependentRole);
		});
	}
}

function auditDependentRoles(guild) {
	for (var dependentRoleId in dependentRoles.requires) {
		if (dependentRoles.requires.hasOwnProperty(dependentRoleId)) {
			let dependentRole = guild.roles.resolve(dependentRoleId);
			if (dependentRole) {
				auditDependentRole(guild, dependentRole);
			}
		}
	}
}

function setDependentRole(guild, dependentRole, requiredRole, skipVerifyMembers) {
	let dependentRoleId = '' + dependentRole.id;
	let requiredRoleId = '' + requiredRole.id;
	let verifyMembers = false;

	if (dependentRoles.requires[dependentRoleId] === undefined) {
		dependentRoles.requires[dependentRoleId] = [requiredRoleId];
		verifyMembers = true;
	} else {
		if (!dependentRoles.requires[dependentRoleId].includes(requiredRoleId)) {
			dependentRoles.requires[dependentRoleId].push(requiredRoleId);
			verifyMembers = true;
		}
	}

	if (dependentRoles.requiredFor[requiredRoleId] === undefined) {
		dependentRoles.requiredFor[requiredRoleId] = [dependentRoleId];
	} else {
		if (!dependentRoles.requiredFor[requiredRoleId].includes(dependentRoleId)) {
			dependentRoles.requiredFor[requiredRoleId].push(dependentRoleId);
		}
	}

	fs.writeFileSync(config.dependentRoles, JSON.stringify(dependentRoles), 'utf8');

	if (verifyMembers && !skipVerifyMembers) {
		auditDependentRole(dependentRole, requiredRole);
	}
}

async function unsetDependentRole(guild, dependentRole, requiredRole) {
	let dependentRoleId = '' + dependentRole.id;
	let requiredRoleId = '' + requiredRole.id;

	if (dependentRoles.requires[dependentRoleId] !== undefined) {
		if (dependentRoles.requires[dependentRoleId].includes(requiredRoleId)) {
			delete dependentRoles.requires[dependentRoleId][requiredRoleId];
		}
		if (dependentRoles.requires[dependentRoleId].length == 0) {
			delete dependentRoles.requires[dependentRoleId];
		}
	}

	if (dependentRoles.requiredFor[requiredRoleId] !== undefined) {
		if (dependentRoles.requiredFor[requiredRoleId].includes(dependentRoleId)) {
			delete dependentRoles.requiredFor[requiredRoleId][dependentRoleId];
		}
		if (dependentRoles.requiredFor[requiredRoleId].length == 0) {
			delete dependentRoles.requiredFor[requiredRoleId];
		}
	}

	fs.writeFileSync(config.dependentRoles, JSON.stringify(dependentRoles), 'utf8');
}

//subrole command processing
async function commandDependentRoles(message, member, cmd, args, guild, perm, permName, isDM) {
	if (args.length <= 0)
		return message.reply('No parameters provided');

	let subcmd = args.shift();
	switch (subcmd) {
		case 'set':
		case 'unset': {
			if (args.length < 2)
				return message.reply('Dependent and Required Roles must be provided');

			let dependentRoleName = args.shift();
			const dependentRole = guild.roles.cache.find(r => { return r.name == dependentRoleName; });
			if (!dependentRole)
				return message.reply(`Role ${dependentRoleName} not found`);

			let requiredRoleName = args.shift();
			const requiredRole = guild.roles.cache.find(r => { return r.name == requiredRoleName; });
			if (!requiredRole)
				return message.reply(`Role ${requiredRoleName} not found`);

			if (subcmd === 'set') {
				setDependentRole(guild, dependentRole, requiredRole, false);
				return message.reply(`Added required role ${requiredRoleName} to dependent role ${dependentRoleName}`);
			} else {
				unsetDependentRole(guild, dependentRole, requiredRole, false);
				return message.reply(`Removed required role ${requiredRoleName} from dependent role ${dependentRoleName}`);
			}
			break;
		}
		case 'list': {
			let embed = {
				title: "Dependent Roles",
				fields: []
			};

			for (var dependentRoleId in dependentRoles.requires) {
				if (dependentRoles.requires.hasOwnProperty(dependentRoleId)) {
					let dependentRole = guild.roles.resolve(dependentRoleId);
					if (dependentRole) {
						let requiredRoles = dependentRoles.requires[dependentRoleId];
						let requiredRoleNames = [];
						for (let i = 0; i < requiredRoles.length; i++) {
							let requiredRoleId = requiredRoles[i];
							let requiredRole = guild.roles.resolve(requiredRoleId);
							if (requiredRole)
								requiredRoleNames.push(requiredRole.name);
						}

						let field = { name: dependentRole.name, value: requiredRoleNames.length ? requiredRoleNames.join("\n") : "*None*" };
						embed.fields.push(field);
					}
				}
			}
			return sendReplyToMessageAuthor(message, member, { embeds: [embed] });
		}
		case 'prune': {
			//FIXME
			return message.reply('Not implemented');
		}
		case 'audit': {
			auditDependentRoles(guild);
			break;
		}
		default: {
			return message.reply(`Unknown command: ${subcmd}`);
		}
	}
}

/*
//retrieve all webhooks for the guild from the discord API
// (for some reason discord.js framework doesn't give us token in the Webhook object
function getWebhooksForGuild(guild)
{
	var getOptions = {
		method: 'GET',
		url: `https://discordapp.com/api/guilds/${guild.id}/webhooks`,
		headers: {
			'User-Agent': 'Discord Bot',
			'Authorization': `Bot ${config.token}`,
			'Content-Type': 'application/json',
		},
		json: true
	};
	process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 1;
	var promise = new Promise(function(resolve, reject)	{
		request(getOptions, function(error, response, body) {
			if (error)
				return reject(error);
			if (body.code)
				return reject(body);
			return resolve(body);	
		});
	});
	return promise;
}

function commandShowWebhooks(message, member, cmd, args, guild, perm, permName, isDM)
{
	if (!message.member)
		return;
	getWebhooksForGuild(guild)
		.then(hooks=>{
			var embed = {title: 'Current Webhooks', fields: []};
			for(i in hooks)
			{
				let hook = hooks[i];
				let channel = guild.channels.resolve(hook.channel_id);
				let channelname = channel?channel.name:hook.channel_id;
				embed.fields.push({
					name: `${hook.name} (Channel: ${channelname})`,
					value: `${hook.id}/${hook.token}`
				});
			}
			message.member.send({embed: embed});
		})
		.catch(error=>{notifyRequestError(guild, error,message,(perm >= PERM_MOD));});
}*/

function commandMute(message, member, cmd, args, guild, perm, permName, isDM) {
	let targetMember = getMemberFromMessageOrArgs(guild, message, args);
	if (!targetMember)
		return message.reply("Please mention a valid member of this server");
	var [memberPerm, memberPermName] = getPermissionLevelForMember(targetMember);
	if (perm <= memberPerm)
		return message.reply(`You cannot mute ${targetMember.user.tag}.`);
	return addRemoveRole(message, guild, cmd === 'mute', config.muteRole, targetMember, true);
}

function commandPTT(message, member, cmd, args, guild, perm, permName, isDM) {
	let targetMember = getMemberFromMessageOrArgs(guild, message, args);
	if (!targetMember)
		return message.reply("Please mention a valid member of this server");
	var [memberPerm, memberPermName] = getPermissionLevelForMember(targetMember);
	if (perm <= memberPerm)
		return message.reply(`You cannot make ${targetMember.user.tag} PTT.`);
	return addRemoveRole(message, guild, cmd === 'setptt', config.pttRole, targetMember, true);
}

//kick command processing
function commandKick(message, member, cmd, args, guild, perm, permName, isDM) {
	let targetMember = getMemberFromMessageOrArgs(guild, message, args);
	if (!targetMember)
		return message.reply("Please mention a valid member of this server");
	if (!targetMember.kickable)
		return message.reply(`I cannot kick ${targetMember.user.tag}.`);
	var [memberPerm, memberPermName] = getPermissionLevelForMember(targetMember);
	if (perm <= memberPerm)
		return message.reply(`You cannot kick ${targetMember.user.tag}.`);

	args.shift(); //trim mention
	let reason = args.join(' ');
	if (!reason || reason == '') reason = "No reason provided";

	targetMember.kick(`Requested by ${getNameFromMessage(message)}: ${reason}`)
		.catch(error => message.reply(`Sorry ${message.author} I couldn't kick because of : ${error}`));
	message.reply(`${targetMember.user.tag} has been kicked by ${message.author.tag} because: ${reason}`);
}

//ban command processing
function commandBan(message, member, cmd, args, guild, perm, permName, isDM) {
	let targetMember = getMemberFromMessageOrArgs(guild, message, args);
	let tag;
	if (targetMember) {
		if (!targetMember.bannable)
			return message.reply(`I cannot ban ${targetMember.user.tag}.`);
		var [memberPerm, memberPermName] = getPermissionLevelForMember(targetMember);
		if (perm <= memberPerm)
			return message.reply(`You cannot ban ${targetMember.user.tag}.`);
		tag = targetMember.user.tag;
	} else {
		targetMember = message.mentions.users.first();
		if (!targetMember)
			return message.reply("Please mention a valid member of this server");
		tag = targetMember.tag;
	}

	args.shift(); //trim mention
	let reason = args.join(' ');
	if (!reason || reason == '') reason = "No reason provided";

	targetMember.ban({ reason: reason })
		.catch(error => message.reply(`Sorry ${message.author} I couldn't ban because of : ${error}`));
	message.reply(`${tag} has been banned by ${message.author.tag} because: ${reason}`);
}

//tracker command processing
async function commandTracker(message, member, cmd, args, guild, perm, permName, isDM) {
	try {
		let data = new URLSearchParams();
		data.append('type', 'discord');
		data.append('text', args.join(' '));
		data.append('token', config.trackerToken);

		let response = await fetch(`${config.trackerURL}/slack`, {
			method: 'post',
			body: data,
			headers: {
				'User-Agent': 'Discord Bot',
				'Accept': 'application/json'
			}
		});
		let body = await response.json();
		if (body.embed)
			return message.reply({ embeds: [body.embed] });
		else if (body.text)
			return message.reply(body.text);
	} catch (e) {
		return message.reply('There was an error processing the request');
	}
}

//get forum groups from forum database
function getForumGroups() {
	var promise = new Promise(function(resolve, reject) {
		let db = connectToDB();
		let query = `SELECT usergroupid AS id,title AS name FROM ${config.mysql.prefix}usergroup WHERE title LIKE "AOD%" OR title LIKE "%Officers" OR title LIKE "Division CO" or title LIKE "Division XO"`;
		db.query(query, function(err, rows, fields) {
			if (err)
				return reject(err);
			else {
				let groupsByID = {};
				for (var i in rows) {
					groupsByID[rows[i].id] = rows[i].name;
				}
				return resolve(groupsByID);
			}
		});
	});
	return promise;
}

const unicodeRegEx = /&#([0-9]+);/g; //BE CAREFUL OF CAPTURE GROUPS BELOW
function convertForumDiscordName(discordName) {
	discordName = discordName.replace(unicodeRegEx, function() {
		//arguments[0] = full unicode
		//arguments[1] = decimal
		//arguments[2] = index of match
		let code = parseInt(arguments[1]);
		if (code > 0xffff)
			return String.fromCodePoint(code);
		else
			return String.fromCharCode(code);
	});
	return htmlEntitiesDecode(discordName, { level: 'html5' });
}

//get forum users from forum groups
var discordTagRegEx = /^[^\s#@][^#@]{0,30}[^\s#@](#(0|[0-9]{4}))?$/g;

function getForumUsersForGroups(groups, allowPending) {
	var promise = new Promise(function(resolve, reject) {
		let usersByIDOrDiscriminator = {};
		let db = connectToDB();
		let groupStr = groups.join(',');
		let groupRegex = groups.join('|');
		let query =
			`SELECT u.userid,u.username,f.field19,f.field20,f.field13,f.field23,f.field24, ` +
			`(CASE WHEN (r.requester_id IS NOT NULL AND r.approver_id IS NULL) THEN 1 ELSE 0 END) AS pending ` +
			`FROM ${config.mysql.prefix}user AS u ` +
			`INNER JOIN ${config.mysql.prefix}userfield AS f ON u.userid=f.userid ` +
			`LEFT JOIN  ${config.mysql.trackerPrefix}member_requests AS r ON u.userid=r.member_id AND r.approver_id IS NULL ` +
			`WHERE (u.usergroupid IN (${groupStr}) OR u.membergroupids REGEXP '(^|,)(${groupRegex})(,|$)' `;
		if (allowPending === true)
			query +=
			`OR r.requester_id IS NOT NULL `;
		query +=
			`) AND ((f.field19 IS NOT NULL AND f.field19 <> '') OR (f.field20 IS NOT NULL AND f.field20 <> '')) ` +
			`ORDER BY f.field13,u.username`;
		let queryError = false;
		db.query(query)
			.on('error', function(err) {
				queryError = true;
				reject(err);
			})
			.on('result', function(row) {
				let discordid = row.field20;
				let discordtag = convertForumDiscordName(row.field19);
				discordTagRegEx.lastIndex = 0;
				/*if (!discordTagRegEx.exec(discordtag)) {
					discordtag += '#0';
				}*/

				let index = discordtag;
				let indexIsId = false;
				if (discordid && discordid != '') {
					index = discordid;
					indexIsId = true;
				}
				if (usersByIDOrDiscriminator[index] !== undefined) {
					console.log(`Found duplicate tag ${usersByIDOrDiscriminator[index].discordtag} (${usersByIDOrDiscriminator[index].discordId}) for forum user ${row.username} first seen for forum user ${usersByIDOrDiscriminator[index].name}`);
				} else {
					usersByIDOrDiscriminator[index] = {
						indexIsId: indexIsId,
						name: row.username,
						id: row.userid,
						division: row.field13,
						discordid: discordid,
						discordtag: discordtag,
						discordstatus: row.field24,
						discordactivity: row.field23,
						pending: row.pending
					};
				}
			})
			.on('end', function(err) {
				if (!queryError)
					resolve(usersByIDOrDiscriminator);
			});
	});
	return promise;
}

function getForumInfoForMember(member) {
	var promise = new Promise(function(resolve, reject) {
		let userData = [];
		let db = connectToDB();
		let query =
			`SELECT u.userid,u.username,f.field13,f.field11,f.field14,g.title ` +
			`FROM ${config.mysql.prefix}user AS u ` +
			`INNER JOIN ${config.mysql.prefix}userfield AS f ON u.userid=f.userid ` +
			`INNER JOIN ${config.mysql.prefix}usergroup AS g ON u.usergroupid=g.usergroupid ` +
			`WHERE f.field20 like "${member.id}" `;
		let queryError = false;
		db.query(query)
			.on('error', function(err) {
				queryError = true;
				reject(err);
			})
			.on('result', function(row) {
				userData.push({
					name: row.username,
					id: row.userid,
					division: row.field13,
					rank: row.field11,
					loaStatus: row.field14,
					forumGroup: row.title
				});
			})
			.on('end', function(err) {
				if (!queryError)
					resolve(userData);
			});
	});
	return promise;
}
global.getForumInfoForMember = getForumInfoForMember;

function truncateStr(str, maxLen) {
	if (str.length <= maxLen)
		return str;
	return str.substr(0, maxLen - 5) + ' ...';
}

function getFieldsFromArray(arr, fieldName) {
	var fields = [];
	var currValue = "";
	for (var i in arr) {
		if (currValue.length + arr[i].length + 2 < 1024) {
			if (currValue.length > 0)
				currValue = currValue + ', ' + arr[i];
			else
				currValue = arr[i];
		} else {
			fields.push({
				name: fieldName + (fields.length > 0 ? ' (cont...)' : ''),
				value: currValue
			});
			currValue = arr[i];
		}
	}
	if (currValue.length)
		fields.push({
			name: fieldName + (fields.length > 0 ? ' (cont...)' : ''),
			value: currValue
		});
	return fields;
}


function setDiscordIDForForumUser(forumUser, guildMember) {
	if (forumUser.discordid == guildMember.user.id)
		return;
	console.log(`Updating Discord ID for ${forumUser.name} (${forumUser.id}) Discord Tag ${guildMember.user.tag} from '${forumUser.discordid}' to '${guildMember.user.id}'`);
	if (config.devMode !== true) {
		let db = connectToDB();
		//let tag = db.escape(convertDiscordTag(guildMember.user.tag));
		let query = `UPDATE ${config.mysql.prefix}userfield SET field20="${guildMember.user.id}" WHERE userid=${forumUser.id}`;
		db.query(query, function(err, rows, fields) {});
	}
	forumUser.discordid = guildMember.user.id;
}

function setDiscordTagForForumUser(forumUser, guildMember) {
	if (forumUser.discordtag == guildMember.user.tag)
		return;
	//handle the case where someone gave us their ID directly
	if (forumUser.discordtag == guildMember.user.id) {
		forumUser.indexIsId = true;
		setDiscordIDForForumUser(forumUser, guildMember);
	}
	console.log(`Updating Discord Tag for ${forumUser.name} (${forumUser.id}) Discord ID ${guildMember.user.id} from '${forumUser.discordtag}' to '${guildMember.user.tag}'`);
	if (config.devMode !== true) {
		let db = connectToDB();
		let tag = db.escape(convertDiscordTag(guildMember.user.tag));
		let query = `UPDATE ${config.mysql.prefix}userfield SET field19=${tag} WHERE field20="${guildMember.user.id}" AND userid=${forumUser.id}`;
		db.query(query, function(err, rows, fields) {});
	}
	forumUser.discordtag = guildMember.user.tag;
}

function setDiscordStatusForForumUser(forumUser, status) {
	if (forumUser.discordstatus === status)
		return;
	console.log(`Updating Discord Status for ${forumUser.name} (${forumUser.id}) from '${forumUser.discordstatus}' to '${status}'`);
	if (config.devMode !== true) {
		let db = connectToDB();
		let query = `UPDATE ${config.mysql.prefix}userfield SET field24='${status}' WHERE userid=${forumUser.id}`;
		db.query(query, function(err, rows, fields) {});
	}
	forumUser.discordstatus = status;
}

const activityInterval_s = 60 * 60; //60 minutes
function setDiscordActivityForForumUser(forumUser, activityEpochMs) {
	activityEpoch = '' + (Math.floor((activityEpochMs / 1000) / activityInterval_s) * activityInterval_s);
	if (forumUser.discordactivity === activityEpoch)
		return;
	console.log(`Updating Discord Activity for ${forumUser.name} (${forumUser.id}) from '${forumUser.discordactivity}' to '${activityEpoch}'`);
	if (config.devMode !== true) {
		let db = connectToDB();
		let query = `UPDATE ${config.mysql.prefix}userfield SET field23='${activityEpoch}' WHERE userid=${forumUser.id}`;
		db.query(query, function(err, rows, fields) {});
	}
	forumUser.discordactivity = activityEpoch;
}

function clearDiscordDataForForumUser(forumUser) {
	console.log(`Clearing Discord data for ${forumUser.name} (${forumUser.id})`);
	if (config.devMode !== true) {
		let db = connectToDB();
		let query = `UPDATE ${config.mysql.prefix}userfield SET field19='', field20='', field23='', field24='' WHERE userid=${forumUser.id}`;
		db.query(query, function(err, rows, fields) {});
	}
}

function matchGuildRoleName(guildRole) {
	return guildRole.name == this;
}


function matchGuildMemberTag(guildMember) {
	return guildMember.user.tag == this;
}

//do forum sync with discord roles
async function doForumSync(message, member, guild, perm, doDaily) {
	var hrStart = process.hrtime();
	await guild.roles.fetch()
		.catch(error => { console.log(error); });
	const guestRole = guild.roles.cache.find(r => { return r.name == config.guestRole; });
	const memberRole = guild.roles.cache.find(r => { return r.name == config.memberRole; });
	const sgtsChannel = guild.channels.cache.find(c => { return c.name === 'aod-sergeants'; });
	const reason = (message ? `Requested by ${getNameFromMessage(message)}` : 'Periodic Sync');
	let adds = 0,
		removes = 0,
		renames = 0,
		duplicates = 0,
		total_misses = 0,
		total_disconnected = 0,
		misses = {},
		disconnected = {};

	let nickNameChanges = {};
	let forumGroups;
	try {
		forumGroups = await getForumGroups();
	} catch (error) {
		return notifyRequestError(message, member, guild, error, (perm >= PERM_MOD));
	}

	let date = new Date();
	try {
		fs.writeFileSync(config.syncLogFile, `${date.toISOString()}  Forum sync started\n`, 'utf8');
	} catch (e) {
		console.error(e);
	}

	let online = 0,
		offline = 0,
		idle = 0,
		dnd = 0,
		total = 0;
	await guild.members.fetch()
		.catch(error => { console.log(error); });
	guild.members.cache.forEach(function(m) {
		if (!m.presence) {
			offline++;
		} else {
			switch (m.presence.status) {
				case 'idle':
					idle++;
					break;
				case 'offline':
					offline++;
					break;
				case 'dnd':
					dnd++;
					break;
				default:
					online++;
			}
		}
		total++;
	});
	try {
		fs.writeFileSync(config.populationLogFile, `${online}/${idle}/${dnd}/${total}\n`, 'utf8');
	} catch (e) {
		console.error(e);
	}

	let localVoiceStatusUpdates = voiceStatusUpdates;
	voiceStatusUpdates = {};

	let seenByID = {}; //make sure we don't have users added as both guest and member
	for (let roleName in forumIntegrationConfig) {
		if (forumIntegrationConfig.hasOwnProperty(roleName)) {
			let groupMap = forumIntegrationConfig[roleName];

			let role;
			if (groupMap.roleID === undefined) {
				//make sure we actually have the roleID in our structure
				role = guild.roles.cache.find(matchGuildRoleName, roleName);
				if (role)
					groupMap.roleID = role.id;
			} else
				role = guild.roles.resolve(groupMap.roleID);

			if (role) {
				let usersByIDOrDiscriminator;
				try {
					usersByIDOrDiscriminator = await getForumUsersForGroups(groupMap.forumGroups, (role.id === memberRole.id));
				} catch (error) {
					notifyRequestError(message, member, guild, error, (perm >= PERM_MOD));
					continue;
				}

				date = new Date();
				fs.appendFileSync(config.syncLogFile, `${date.toISOString()}  Sync ${role.name}\n`, 'utf8');
				let embed = {
					title: `Sync ${role.name}`,
					fields: []
				};

				//console.log(`${date.toISOString()} Start processing ${role.name} role members`);

				//for each guild member with the role
				//   track them by tag so we can easily access them again later
				//   if their tags aren't configured on the forums, mark for removal
				//   make sure anyone remaining has a valid nickname
				let toRemove = [];
				let toUpdate = [];
				let membersByID = {};
				let duplicateTag = [];
				for (let roleMember of role.members.values()) {
					membersByID[roleMember.user.id] = roleMember;
					let forumUser = usersByIDOrDiscriminator[roleMember.user.id];
					if (forumUser === undefined) {
						forumUser = usersByIDOrDiscriminator[roleMember.user.tag];
						if (forumUser !== undefined) {
							forumUser.indexIsId = true;
							usersByIDOrDiscriminator[roleMember.user.id] = forumUser;
							delete usersByIDOrDiscriminator[roleMember.user.tag];
							setDiscordIDForForumUser(forumUser, roleMember);
						}
					}

					if (forumUser === undefined) {
						if (role.id !== guestRole.id) {
							removes++;
							toRemove.push(`${roleMember.user.tag} (${roleMember.displayName})`);
							try {
								await roleMember.roles.remove(role, reason);
								if (role.id === memberRole.id) {
									//we're removing them from AOD, clear the name set from the forums
									await roleMember.setNickname('', reason);
									//Members shouldn't have been guests... lest there be a strange permission thing when AOD members are removed
									if (roleMember.roles.cache.get(guestRole.id))
										await roleMember.roles.remove(guestRole);
								}
							} catch (error) {
								console.error(`Failed to remove ${role.name} from ${roleMember.user.tag}`);
								notifyRequestError(message, member, guild, error, (perm >= PERM_MOD));
							}
						}
					} else {
						if (nickNameChanges[roleMember.user.id] === undefined && roleMember.displayName !== forumUser.name) {
							nickNameChanges[roleMember.user.id] = true;
							if (role.id !== guestRole.id) {
								renames++;
								toUpdate.push(`${roleMember.user.tag} (${roleMember.displayName} ==> ${forumUser.name})`);
							}
							try {
								await roleMember.setNickname(forumUser.name, reason);
							} catch (error) {
								notifyRequestError(message, member, guild, error, (perm >= PERM_MOD));
								continue;
							}
						}
						setDiscordTagForForumUser(forumUser, roleMember);
						setDiscordStatusForForumUser(forumUser, 'connected');
						if (roleMember.voice.channel)
							setDiscordActivityForForumUser(forumUser, date.getTime());
						else if (localVoiceStatusUpdates[roleMember.id])
							setDiscordActivityForForumUser(forumUser, localVoiceStatusUpdates[roleMember.id]);

						//Members shouldn't also be guests... lest there be a strange permission thing when AOD members are removed
						if (role.id === memberRole.id) {
							if (seenByID[roleMember.id] !== undefined) {
								duplicateTag.push(`${roleMember.user.tag} (${forumUser.name}) -- First seen user ${seenByID[roleMember.id].name}`);
								duplicates++;
							} else {
								seenByID[roleMember.id] = forumUser;
							}
							if (roleMember.roles.cache.get(guestRole.id)) {
								try {
									await roleMember.roles.remove(guestRole);
								} catch (error) {
									notifyRequestError(message, member, guild, error, (perm >= PERM_MOD));
									continue;
								}
							}
						} else if (role.id === guestRole.id) {
							if (seenByID[roleMember.id] !== undefined) {
								duplicateTag.push(`${roleMember.user.tag} (${forumUser.name}) -- First seen user ${seenByID[roleMember.id].name}`);
								duplicates++;
							} else {
								seenByID[roleMember.id] = forumUser;
							}
							if (roleMember.roles.cache.get(memberRole.id)) {
								try {
									await roleMember.roles.remove(memberRole);
								} catch (error) {
									notifyRequestError(message, member, guild, error, (perm >= PERM_MOD));
									continue;
								}
							}
						}
					}
				}

				//date = new Date();
				//console.log(`${date.toISOString()} Start processing ${role.name} forum members`);

				//for each forum member mapped to the role
				//   if we haven't already seen the guild member
				//       if there is a guild member record, at them to the role and make sure the nickname is valid
				//       otherwise, mark them as an error and move on
				let toAdd = [];
				let noAccount = [];
				let leftServer = [];
				for (let u in usersByIDOrDiscriminator) {
					if (usersByIDOrDiscriminator.hasOwnProperty(u)) {
						if (membersByID[u] === undefined) {
							let forumUser = usersByIDOrDiscriminator[u];
							//don't add members who are pending
							if (forumUser.pending)
								continue;

							let guildMember = guild.members.resolve(u);
							if ((guildMember === undefined || guildMember === null) && !forumUser.indexIsId) {
								guildMember = guild.members.cache.find(matchGuildMemberTag, u);
								if (guildMember) {
									//don't update the list, we're done processing
									setDiscordIDForForumUser(forumUser, guildMember);
								}
							}
							if (guildMember) {
								if (role.id !== guestRole.id) {
									adds++;
									toAdd.push(`${guildMember.user.tag} (${forumUser.name})`);
								}
								try {
									await guildMember.roles.add(role, reason);
								} catch (error) {
									console.error(`Failed to add ${role.name} to ${guildMember.user.tag}`);
									notifyRequestError(message, member, guild, error, (perm >= PERM_MOD));
									continue;
								}
								if (nickNameChanges[guildMember.user.id] === undefined && guildMember.displayName !== forumUser.name) {
									nickNameChanges[guildMember.user.id] = true;
									if (role.id !== guestRole.id) {
										renames++;
										toUpdate.push(`${guildMember.user.tag} (${guildMember.displayName} ==> ${forumUser.name})`);
									}
									try {
										await guildMember.setNickname(forumUser.name, reason);
									} catch (error) {
										console.error(`Failed to rename ${guildMember.user.tag} to ${forumUser.name}`);
										notifyRequestError(message, member, guild, error, (perm >= PERM_MOD));
										continue;
									}
								}
								setDiscordTagForForumUser(forumUser, guildMember);
								setDiscordStatusForForumUser(forumUser, 'connected');
								if (guildMember.voice.channel)
									setDiscordActivityForForumUser(forumUser, date.getTime());
								else if (localVoiceStatusUpdates[guildMember.id])
									setDiscordActivityForForumUser(forumUser, localVoiceStatusUpdates[guildMember.id]);
							} else {
								if (role.id === memberRole.id) {
									if (forumUser.indexIsId) {
										if (disconnected[forumUser.division] === undefined)
											disconnected[forumUser.division] = 0;
										disconnected[forumUser.division]++;
										total_disconnected++;
										leftServer.push(`${u} (${forumUser.name} -- ${forumUser.division})`);
										setDiscordStatusForForumUser(forumUser, 'disconnected');
									} else {
										if (misses[forumUser.division] === undefined)
											misses[forumUser.division] = 0;
										misses[forumUser.division]++;
										total_misses++;
										noAccount.push(`${u} (${forumUser.name} -- ${forumUser.division})`);
										setDiscordStatusForForumUser(forumUser, 'never_connected');
									}
								} else if (role.id === guestRole.id) {
									//We don't need to constantly reprocess old AOD members who have left or forum guests who visited discord once
									clearDiscordDataForForumUser(forumUser);
								}
							}
						}
					}
				}

				//date = new Date();
				//console.log(`${date.toISOString()} Done processing ${role.name}`);

				if (role.id !== guestRole.id) {
					let sendMessage = false;
					if (toAdd.length) {
						sendMessage = true;
						fs.appendFileSync(config.syncLogFile, `\tMembers to add (${toAdd.length}):\n\t\t`, 'utf8');
						fs.appendFileSync(config.syncLogFile, toAdd.join('\n\t\t') + "\n", 'utf8');
						if (message)
							embed.fields.push({
								name: `Members to add (${toAdd.length})`,
								value: truncateStr(toAdd.join(', '), 1024)
							});
					}
					if (noAccount.length) {
						sendMessage = true;
						fs.appendFileSync(config.syncLogFile, `\tMembers to add with no discord user (${noAccount.length}):\n\t\t`, 'utf8');
						fs.appendFileSync(config.syncLogFile, noAccount.join('\n\t\t') + "\n", 'utf8');
						if (message)
							embed.fields.push({
								name: `Members to add with no discord user (${noAccount.length})`,
								value: truncateStr(noAccount.join(', '), 1024)
							});
					}
					if (leftServer.length) {
						sendMessage = true;
						fs.appendFileSync(config.syncLogFile, `\tMembers who have left server (${leftServer.length}):\n\t\t`, 'utf8');
						fs.appendFileSync(config.syncLogFile, leftServer.join('\n\t\t') + "\n", 'utf8');
						if (message)
							embed.fields.push({
								name: `Members who have left server (${leftServer.length})`,
								value: truncateStr(leftServer.join(', '), 1024)
							});
					}
					if (toRemove.length) {
						sendMessage = true;
						fs.appendFileSync(config.syncLogFile, `\tMembers to remove (${toRemove.length}):\n\t\t`, 'utf8');
						fs.appendFileSync(config.syncLogFile, toRemove.join('\n\t\t') + "\n", 'utf8');
						if (message)
							embed.fields.push({
								name: `Members to remove (${toRemove.length})`,
								value: truncateStr(toRemove.join(', '), 1024)
							});
					}
					if (toUpdate.length) {
						sendMessage = true;
						fs.appendFileSync(config.syncLogFile, `\tMembers to rename (${toUpdate.length}):\n\t\t`, 'utf8');
						fs.appendFileSync(config.syncLogFile, toUpdate.join('\n\t\t') + "\n", 'utf8');
						if (message)
							embed.fields.push({
								name: `Members to rename (${toUpdate.length})`,
								value: truncateStr(toUpdate.join(', '), 1024)
							});
					}
					if (duplicateTag.length) {
						sendMessage = true;
						fs.appendFileSync(config.syncLogFile, `\tDuplicate Tags (${duplicateTag.length}):\n\t\t`, 'utf8');
						fs.appendFileSync(config.syncLogFile, duplicateTag.join('\n\t\t') + "\n", 'utf8');
						if (message)
							embed.fields.push({
								name: `Duplicate Tags (${duplicateTag.length})`,
								value: truncateStr(duplicateTag.join(', '), 1024)
							});
					}
					if (message && sendMessage) {
						sendReplyToMessageAuthor(message, member, { embeds: [embed] });
					}
				}
			}
		}
	}

	//notifications
	if (doDaily) {
		let divisions = await global.getDivisionsFromTracker();
		for (const divisionName in divisions) {
			if (divisions.hasOwnProperty(divisionName)) {
				if (misses[divisionName] || disconnected[divisionName]) {
					const divisionData = divisions[divisionName];
					let division_misses = misses[divisionName] ?? 0;
					let division_disconnected = disconnected[divisionName] ?? 0;
					let officer_channel = guild.channels.cache.find(c => c.name === divisionData.officer_channel && c.type === ChannelType.GuildText) ?? sgtsChannel;
					if (officer_channel) {
						officer_channel.send(`${divisionName} Division: ` +
							`The forum sync process found ${division_misses} members with no discord account and ` +
							`${division_disconnected} members who have left the server. ` +
							`Please check ${config.trackerURL}/divisions/${divisionData.slug}/voice-report`).catch(() => {});
					}
				}
			}
		}
	}
	if (duplicates > 0) {
		if (sgtsChannel) {
			sgtsChannel.send(`The forum sync process found ${duplicates} duplicate tags. Please check https://www.clanaod.net/forums/aodinfo.php?type=last_discord_sync for the last sync status.`).catch(() => {});
		}
	}

	let hrEnd = process.hrtime(hrStart);
	let hrEndS = sprintf('%.3f', (hrEnd[0] + hrEnd[1] / 1000000000));
	let msg = `Forum Sync Processing Time: ${hrEndS}s; ` +
		`${adds} roles added, ${removes} roles removed, ${renames} members renamed, ${total_misses} members with no discord account, ` +
		`${total_disconnected} members who have left the server, ${duplicates} duplicate tags`;
	if (message)
		sendReplyToMessageAuthor(message, member, msg);
	if (message || adds || removes || renames)
		console.log(msg);
	date = new Date();
	fs.appendFileSync(config.syncLogFile, `${date.toISOString()}  ${msg}\n`, 'utf8');
}


function addForumSyncMap(message, guild, roleName, groupName) {
	const role = guild.roles.cache.find(r => { return r.name == roleName; });
	if (!role)
		return ephemeralReply(message, `${roleName} role not found`);
	let map = forumIntegrationConfig[role.name];
	if (map && map.permanent)
		return ephemeralReply(message, `${roleName} can not be edited`);

	getForumGroups()
		.then(forumGroups => {
			var forumGroupId = parseInt(Object.keys(forumGroups).find(k => forumGroups[k] === groupName), 10);
			if (forumGroupId !== undefined && !isNaN(forumGroupId)) {
				//don't use the version from our closure to prevent asynchronous stuff from causing problems
				let map = forumIntegrationConfig[role.name];
				if (map === undefined) {
					forumIntegrationConfig[role.name] = {
						permanent: false,
						forumGroups: [forumGroupId],
						roleID: `${role.id}`
					};
					fs.writeFileSync(config.forumGroupConfig, JSON.stringify(forumIntegrationConfig), 'utf8');
					getRolesByForumGroup(guild, true);
					return ephemeralReply(message, `Mapped group ${groupName} to role ${role.name}`);
				} else {
					let index = map.forumGroups.indexOf(forumGroupId);
					if (index < 0) {
						map.forumGroups.push(forumGroupId);
						fs.writeFileSync(config.forumGroupConfig, JSON.stringify(forumIntegrationConfig), 'utf8');
						getRolesByForumGroup(guild, true);
						return ephemeralReply(message, `Mapped group ${groupName} to role ${role.name}`);
					} else {
						return ephemeralReply(message, 'Map already exists');
					}
				}
			} else {
				return ephemeralReply(message, `${groupName} forum group not found`);
			}
		})
		.catch(error => { notifyRequestError(message, member, guild, error, (perm >= PERM_MOD)); });
}

function removeForumSyncMap(message, guild, roleName, groupName) {
	const role = guild.roles.cache.find(r => { return r.name == roleName; });
	if (!role)
		return message.reply(`${roleName} role not found`);
	let map = forumIntegrationConfig[role.name];
	if (!map)
		return message.reply('Map does not exist');
	if (map.permanent)
		return message.reply(`${roleName} can not be edited`);

	getForumGroups()
		.then(forumGroups => {
			var forumGroupId = parseInt(Object.keys(forumGroups).find(k => {
				if (forumGroups[k] !== groupName)
					return false;
				return true;
			}), 10);

			let map = forumIntegrationConfig[role.name];
			let index = map.forumGroups.indexOf(forumGroupId);
			if (index < 0) {
				return message.reply('Map does not exist');
			} else {
				map.forumGroups.splice(index, 1);
				if (map.forumGroups.length === 0)
					delete forumIntegrationConfig[role.name];
				fs.writeFileSync(config.forumGroupConfig, JSON.stringify(forumIntegrationConfig), 'utf8');
				getRolesByForumGroup(guild, true);
				return message.reply(`Removed map of group ${groupName} to role ${role.name}`);
			}
		})
		.catch(error => { notifyRequestError(message, member, guild, error, (perm >= PERM_MOD)); });
}

//forum sync command processing
function commandForumSync(message, member, cmd, args, guild, perm, permName, isDM) {
	let subCmd = args.shift();
	if (!subCmd)
		return;

	switch (subCmd) {
		case 'showmap': {
			getForumGroups()
				.then(forumGroups => {
					var fields = [];
					Object.keys(forumIntegrationConfig).forEach(roleName => {
						var groupMap = forumIntegrationConfig[roleName];
						fields.push({
							name: roleName + (groupMap.permanent ? ' (permanent)' : ''),
							value: groupMap.forumGroups.map(groupID => `${forumGroups[groupID]} (${groupID})`).join(', ')
						});
						if (fields.length >= 25) {
							sendReplyToMessageAuthor(message, member, { embeds: [{ title: 'Configured Group Maps', fields: fields }] });
							fields = [];
						}
					});

					if (fields.length > 0) {
						sendReplyToMessageAuthor(message, member, { embeds: [{ title: 'Configured Group Maps', fields: fields }] });
					}
				})
				.catch(error => { notifyRequestError(message, member, guild, error, (perm >= PERM_MOD)); });
			break;
		}
		case 'showroles': {
			let embed = {
				title: '',
				fields: [{
					name: 'Discord Officer Roles',
					value: guild.roles.cache.filter(r => r.name.endsWith(config.discordOfficerSuffix)).map(r => r.name).sort().join("\n")
				}]
			};
			sendReplyToMessageAuthor(message, member, { embeds: [embed] });
			break;
		}
		case 'showforumgroups': {
			getForumGroups()
				.then(forumGroups => {
					var list = Object.keys(forumGroups).map(k => `${forumGroups[k]} (${k})`).sort();
					var i, j, size = 25;
					for (i = 0, j = list.length; i < j; i += size) {
						let chunk = list.slice(i, i + size);
						let embed = {
							title: '',
							fields: [{
								name: 'AOD Forum Groups',
								value: chunk.join("\n")
							}]
						};
						sendReplyToMessageAuthor(message, member, { embeds: [embed] });
					}
				})
				.catch(error => { notifyRequestError(message, member, guild, error, (perm >= PERM_MOD)); });
			break;
		}
		case 'sync':
			doForumSync(message, member, guild, perm, false);
			break;
		case 'add': {
			let roleName = args.shift();
			let groupName = args.shift();

			if (!roleName.endsWith(config.discordOfficerSuffix))
				return message.reply('Only Officer Roles may be mapped');
			if (!groupName.endsWith(config.forumOfficerSuffix))
				return message.reply('Only Officer Groups may be mapped');

			addForumSyncMap(message, guild, roleName, groupName);
			break;
		}
		case 'rem': {
			let roleName = args.shift();
			let groupName = args.shift();

			if (!roleName.endsWith(config.discordOfficerSuffix))
				return message.reply('Only Officer Roles may be mapped');
			if (!groupName.endsWith(config.forumOfficerSuffix))
				return message.reply('Only Officer Groups may be mapped');

			removeForumSyncMap(message, guild, roleName, groupName);
			break;
		}
		case 'prune': {
			let doWrite = false;
			let reply = "";
			Object.keys(forumIntegrationConfig).forEach(roleName => {
				const role = guild.roles.cache.find(r => { return r.name == roleName; });
				if (!role) {
					reply += `Remove map for deleted role ${roleName}\n`;
					delete forumIntegrationConfig[roleName];
					doWrite = true;
				}
			});
			if (doWrite) {
				fs.writeFileSync(config.forumGroupConfig, JSON.stringify(forumIntegrationConfig), 'utf8');
				getRolesByForumGroup(guild, true);
			}
			reply += "Prune complete.";
			sendReplyToMessageAuthor(message, member, reply);
			break;
		}
		default: {
			return message.reply(`Unknown command: ${subCmd}`);
		}
	}
}

//function to send a message to a change that always returns a promise (simplifies exception handling)
function sendMessageToChannel(channel, content, existingMessage) {
	if (existingMessage)
		return existingMessage.edit(content);
	else
		return channel.send(content);
}

//relay command processing
async function commandRelay(message, member, cmd, args, guild, perm, permName, isDM) {
	if (isDM)
		return;
	if (args.length <= 0)
		return;

	let channel = getChannelFromMessageOrArgs(guild, message, args);
	if (channel)
		args.shift();
	else
		channel = message.channel;

	if (channel.type !== ChannelType.GuildText)
		return;

	if (args.length <= 0)
		return;
	await channel.messages.fetch(args[0])
		.catch(() => {});
	let existingMessage;
	if (args[0] == "relayed") {
		args.shift();
		if (args.length <= 0)
			return;
		map = relayedMessageMap[args[0]];
		if (!map)
			return;
		await channel.messages.fetch(map.messageId)
			.catch(() => {});
		existingMessage = channel.messages.resolve(map.messageId);
	} else {
		await channel.messages.fetch(args[0])
			.catch(() => {});
		existingMessage = channel.messages.resolve(args[0]);
	}
	if (existingMessage)
		args.shift();

	let content = args.join(' ');
	if (!content || content === '')
		return;

	let json;
	let relayId;
	try {
		json = JSON.parse(content);
		if (json.embed !== undefined)
			content = { embeds: [json.embed] };
		else if (json.text !== undefined)
			content = json.text;
		else
			return;
		relayId = json.id;
	} catch (e) {}

	sendMessageToChannel(channel, content, existingMessage)
		.then((relayed) => {
			if (message.author.bot && message.webhookId && message.webhookId === message.author.id) {
				//approved bot, save message if given id
				if (!existingMessage && relayId) {
					relayedMessageMap[relayId] = {
						messageId: relayed.id,
						epoch: (new Date()).getTime()
					};
					fs.writeFileSync(config.relayedMessageMap, JSON.stringify(relayedMessageMap), 'utf8');
				}
			}
		})
		.finally(() => { if (!isDM) message.delete(); })
		.catch(error => { notifyRequestError(message, member, guild, error, PERM_NONE); });
}

//react command processing
async function commandReact(message, member, cmd, args, guild, perm, permName, isDM) {
	if (isDM)
		return;
	if (args.length <= 0)
		return;

	let channelName = args[0].toLowerCase();
	let channel = guild.channels.cache.find(c => { return (c.name.toLowerCase() == channelName); });
	if (channel)
		args.shift();
	else
		channel = message.channel;

	if (channel.type !== ChannelType.GuildText)
		return;

	if (args.length <= 0)
		return;

	let existingMessage;
	let relayed = false;
	if (args[0] == "relayed") {
		relayed = true;
		args.shift();
		if (args.length <= 0)
			return;
		map = relayedMessageMap[args[0]];
		if (!map)
			return;
		await channel.messages.fetch(map.messageId)
			.catch(() => {});
		existingMessage = channel.messages.resolve(map.messageId);
	} else {
		await channel.messages.fetch(args[0])
			.catch(() => {});
		existingMessage = channel.messages.resolve(args[0]);
	}
	args.shift();
	if (!existingMessage)
		return;

	if (args.length <= 0)
		return;
	if (args[0] == "clear") {
		args.shift();
		if (args.length <= 0 || args[0] == "self") {
			//clear self reactions
			const userReactions = existingMessage.reactions.cache.filter(reaction => reaction.users.cache.has(client.user.id));
			try {
				for (const reaction of userReactions.values()) {
					await reaction.users.remove(client.user.id);
				}
			} catch (e) {}
		} else if (args[0] == "all") {
			//clear all reactions
			existingMessage.reactions.removeAll();
		} else {
			//remove reaction entirely if emoji passed
			let existingReaction = existingMessage.reactions.cache.get(args[0]);
			if (existingReaction) {
				existingReaction.remove();
			} else {
				//remove all reactions from member if member passed
				let targetMember = getMemberFromMessageOrArgs(guild, message, args);
				if (targetMember) {
					const userReactions = existingMessage.reactions.cache.filter(reaction => reaction.users.cache.has(client.user.id));
					try {
						for (const reaction of userReactions.values()) {
							await reaction.users.remove(client.user.id);
						}
					} catch (e) {}
				}
			}
		}
	} else if (relayed) {
		//relayed messages only come from the tracker webhook right now, make the reactions exclusive
		await existingMessage.reactions.removeAll();
		existingMessage.react(args[0]);
	} else {
		let existingReaction = existingMessage.reactions.cache.get(args[0]);
		if (existingReaction && existingReaction.users.resolve(client.user.id)) {
			await existingReaction.users.remove(client.user.id);
		} else {
			existingMessage.react(args[0]);
		}
	}

	if (!isDM) message.delete();
}

//relaydm command processing
function commandRelayDm(message, member, cmd, args, guild, perm, permName, isDM) {
	if (args.length <= 0)
		return;
	let targetMember = getMemberFromMessageOrArgs(guild, message, args);
	if (!targetMember)
		return;
	args.shift();

	let content = args.join(' ');
	if (!content || content === '')
		return;

	sendMessageToMember(targetMember, content)
		.finally(() => { if (!isDM) message.delete(); })
		.catch(console.error);
}

//admin command processing
function commandSetAdmin(message, member, cmd, args, guild, perm, permName, isDM) {
	addRemoveRole(message, guild, cmd === 'addadmin', 'Admin', getMemberFromMessageOrArgs(guild, message, args), true);
}

//reload command processing
function commandReload(message, member, cmd, args, guild, perm, permName, isDM) {
	console.log(`Reload config requested by ${getNameFromMessage(message)}`);
	config = require('./aod-discord-bot.config.json');
	message.reply('Configuration reloaded');
}

function secondsToString(seconds) {
	seconds = Math.round(seconds);
	let minutes = Math.floor(seconds / 60);
	seconds -= (minutes * 60);
	let hours = Math.floor(minutes / 60);
	minutes -= (hours * 60);
	let days = Math.floor(hours / 24);
	hours -= (days * 24);
	let str = sprintf('%dh %dm %ds', hours, minutes, seconds);
	if (days) str = `${days}d ` + str;
	return str;
}
global.secondsToString = secondsToString;

//status command processing
function commandStatus(message, member, cmd, args, guild, perm, permName, isDM) {
	let uptimeSeconds = Math.round(client.uptime / 1000);
	let now = new Date();
	let lastForumSyncDiff = new Date(now - global.lastForumSync);
	let nextTimerSeconds = ((nextSavedTimerEpoch ? nextSavedTimerEpoch : now.getTime()) - now.getTime()) / 1000;
	let embed = {
		title: 'Bot Status',
		fields: [
			{ name: 'UpTime', value: secondsToString(uptimeSeconds) },
			{ name: 'Server Status', value: `${guild.name} has ${guild.members.cache.size} members and ${guild.channels.cache.size} channels` },
			{ name: 'Last Forum Sync', value: `${lastForumSyncDiff.getMinutes()} minutes, ${lastForumSyncDiff.getSeconds()} seconds ago` },
			{ name: 'Average WebSocket Hearbeat Time', value: `${client.ws.ping}ms` },
			{ name: 'Timers', value: `${savedTimers.length} timers, next timer expires in ${secondsToString(nextTimerSeconds)}` },
		]
	};
	message.reply({ embeds: [embed] });
}

//quit command processing
function commandQuit(message, member, cmd, args, guild, perm, permName, isDM) {
	console.log(`Bot quit requested by ${getNameFromMessage(message)}`);
	client.destroy();
	process.exit();
}

//reload slash command processing
function commandReloadCommands(message, member, cmd, args, guild, perm, permName, isDM) {
	console.log(`Bot reload slash commands requested by ${getNameFromMessage(message)}`);
	loadSlashCommands();
}

//reload API server processing
var api_https_server;
var sockets = {},
	nextSocketId = 0;

function stopAPIServer() {
	let promise = new Promise(function(resolve, reject) {
		for (let socketId in sockets) {
			sockets[socketId].destroy();
			delete sockets[socketId];
		}
		api_https_server.close(() => { resolve(); });
		setImmediate(function() { api_https_server.emit('close'); });
	});
	return promise;
}
async function startAPIServer() {
	try {
		if (api_https_server) {
			await stopAPIServer();
			api_https_server = null;
			delete require.cache[require.resolve('./api/api.js')];
		}

		const { api } = require('./api/api.js');
		let api_server_cert = fs.readFileSync(config.botAPICert);
		let api_server_key = fs.readFileSync(config.botAPIKey);
		api_https_server = https.createServer({
			cert: api_server_cert,
			key: api_server_key
		}, api);

		api_https_server.on('error', (error) => {
			console.log(error);
		});
		api_https_server.on('connection', (socket) => {
			let socketId = nextSocketId++;
			sockets[socketId] = socket;
			socket.on('close', function() {
				delete sockets[socketId];
			});
		});

		api_https_server.listen(config.botAPIPort);
	} catch (error) {
		console.log(error);
	}
}

function commandReloadAPI(message, member, cmd, args, guild, perm, permName, isDM) {
	console.log(`Bot reload API server requested by ${getNameFromMessage(message)}`);
	startAPIServer();
}


var timeStrRegEx = /^\s*((\d+)d)?((\d+)h)?((\d+)m)?((\d+)s)?\s*$/; //BE CAREFUL OF CAPTURE GROUPS BELOW
function processTimeStr(string) {
	let match = timeStrRegEx.exec(string);
	if (match == null)
		return -1;
	let days = (match[2] ? parseInt(match[2]) : 0);
	let hours = (match[4] ? parseInt(match[4]) : 0);
	let minutes = (match[6] ? parseInt(match[6]) : 0);
	let seconds = (match[8] ? parseInt(match[8]) : 0);
	seconds += (minutes * 60);
	seconds += (hours * 3600);
	seconds += (days * 86400);
	return seconds;
}

function commandSlap(message, member, cmd, args, guild, perm, permName, isDM) {
	let targetMember = getMemberFromMessageOrArgs(guild, message, args);
	let tag;
	if (isDM) {
		return message.reply(`You can only slap people in text channels`);
	}
	if (!targetMember) {
		return message.reply("Please mention a valid member of this server");
	}
	let object;
	if (args.length > 0)
		args.shift();
	if (args.length)
		object = args.join(' ');
	else
		object = 'a large trout';
	return message.channel.send(`_${member} slaps ${targetMember} around a bit with ${object}._`)
		.then(() => { message.delete(); })
		.catch(() => {});
}

async function commandTest(message, member, cmd, args, guild, perm, permName, isDM) {
	//console.log("test:" + args.join(' '));
	//message.reply("test: " + args.join(' '));
	/*
	let divisions = await getDivisionsFromTracker();
	console.log(divisions);
	message.reply('done');
	*/
}

//command definitions
commands = {
	/*
	command: {
		minPermission: PERM_LEVEL,
		args: array of "String" or "String",
		helpText: array of "String" or "String",
		callback: function(message, cmd, args, guild, perm, permName, isDM)
		dmOnly: optional boolean (default false)
		doLog: optional boolean (default true)
		logArgs: optional boolean (default true)
	},
	*/
	help: {
		minPermission: PERM_NONE,
		args: "[<command>]",
		helpText: "Displays the help menu. If <command> is present, only that command will be shown.",
		callback: commandHelp,
		doLog: false
	},
	login: {
		minPermission: PERM_NONE,
		args: ["\"<username|email>\"", "\"<password>\""],
		helpText: "Associate discord user to AOD forum account.\nWARNING: This command may only be used in a DM to the discord bot.",
		callback: commandLogin,
		dmOnly: true,
		logArgs: false
	},
	ping: {
		minPermission: PERM_GUEST,
		args: "",
		helpText: "Returns a DM letting you know the bot is alive. Staff and Moderators will get an estimate of network latency.",
		callback: commandPing,
		doLog: false
	},
	roll: {
		minPermission: PERM_GUEST,
		args: "[<count>d<size>]",
		helpText: "Roll a dice. A six sided dice is used by default. An optional number of dice from 1 to 20 and an optional number of sides from 1 to 100 may be provided.",
		callback: commandRoll,
		doLog: false
	},
	flip: {
		minPermission: PERM_GUEST,
		args: "",
		helpText: "Flip a coin.",
		callback: commandFlip,
		doLog: false
	},
	reminder: {
		minPermission: PERM_MEMBER,
		args: "[rem <reminder>|<timeout> <message>]",
		helpText: ["Set a message to receive as a reminder on a specified timeout. If no options are provided, current reminders are show.",
			"*rem*: Remove and cancel the specified reminder.",
			"*timeout*: Reminder timeout. Format: #d#h#m#s Ex: 1d30m",
			"*message*: The message to be send in the reminder."],
		callback: commandReminder,
		doLog: false
	},
	sub: {
		minPermission: PERM_GUEST,
		args: ["[@mention]", "<role>"],
		helpText: "Subscribe to a role. Use @mention to assign a role to someone else (requires Moderator permissions)",
		callback: commandSub
	},
	unsub: {
		minPermission: PERM_GUEST,
		args: ["[@mention]", "<role>"],
		helpText: "Unsubscribe from a role. Use @mention to remove a role from someone else (requires Moderator permissions)",
		callback: commandSub
	},
	list: {
		minPermission: PERM_GUEST,
		args: ["[@mention]"],
		helpText: "List subscribable roles. Use @mention to show assignable roles for someone else (requires Moderator permissions)",
		callback: commandSub
	},
	tracker: {
		minPermission: PERM_MEMBER,
		args: "<query>",
		helpText: "Clan Tracker Integration",
		callback: commandTracker
	},
	mute: {
		minPermission: PERM_MOD,
		args: "<@mention|tag|snowflake>",
		helpText: "Adds the Muted role to the user.",
		callback: commandMute
	},
	unmute: {
		minPermission: PERM_MOD,
		args: "<@mention|tag|snowflake>",
		helpText: "Removes the Muted role from the user.",
		callback: commandMute
	},
	setptt: {
		minPermission: PERM_MOD,
		args: "<@mention|tag|snowflake>",
		helpText: "Adds the Force Push-to-Talk role to the user.",
		callback: commandPTT
	},
	clearptt: {
		minPermission: PERM_MOD,
		args: "<@mention|tag|snowflake>",
		helpText: "Removes the Force Push-to-Talk role from the user.",
		callback: commandPTT
	},
	kick: {
		minPermission: PERM_RECRUITER,
		args: "<@mention|tag|snowflake> [<reason>]",
		helpText: "Kicks the mentioned user from the server.",
		callback: commandKick
	},
	ban: {
		minPermission: PERM_MOD,
		args: "<@mention|tag|snowflake> [<reason>]",
		helpText: "Bans the mentioned user from the server.",
		callback: commandBan
	},
	addaod: {
		minPermission: PERM_RECRUITER,
		args: "<@mention|tag|snowflake>",
		helpText: "Adds the mentioned user to the AOD Members role.",
		callback: commandSetAOD
	},
	remaod: {
		minPermission: PERM_MOD,
		args: "<@mention|tag|snowflake>",
		helpText: "Removes the mentioned user from the AOD Members role.",
		callback: commandSetAOD
	},
	addguest: {
		minPermission: PERM_MOD,
		args: "<@mention|tag|snowflake>",
		helpText: "Adds the mentioned user to the Guest role.",
		callback: commandSetGuest
	},
	remguest: {
		minPermission: PERM_MOD,
		args: "<@mention|tag|snowflake>",
		helpText: "Removes the mentioned user from the Guest role.",
		callback: commandSetGuest
	},
	voice: {
		minPermission: PERM_RECRUITER,
		args: ["<category>", "[<feed|guest|member|role|officer|mod|staff|admin>]", "[<roleName>]", "<name>"],
		helpText: ["Creates a temporary voice channel visible to Members+ by default.\nIf <category> is provided, the channel will be permanent in that cateogry (requires division commander permissions).",
			"*guest*: channel is visible to everyone (requires Moderator permissions)",
			"*member*: channel is visible to Member+ (requires Officer permissions)",
			"*role*: channel is visible to a specific role (requires Divivion Commander permissions)",
			"*officer*: channel is visible to Officers+ (requires Moderator permissions)",
			"*mod*: channel is visible to Moderator+ (requires Moderator permissions)",
			"*staff*: channel is visible to Staff+ (requires Staff permissions)",
			"*admin*: channel is visible to Admins (requires Admin permissions)"],
		callback: commandAddChannel
	},
	ptt: {
		minPermission: PERM_RECRUITER,
		args: ["<category>", "[<feed|guest|member|role|officer|mod|staff|admin>]", "[<roleName>]", "<name>"],
		helpText: ["Creates a temporary push-to-talk channel visible to Members+ by default.\nIf <category> is provided, the channel will be permanent in that cateogry (requires division commander permissions).",
			"*guest*: channel is visible to everyone (requires Moderator permissions)",
			"*member*: channel is visible to Member+ (requires Officer permissions)",
			"*role*: channel is visible to a specific role (requires Divivion Commander permissions)",
			"*officer*: channel is visible to Officers+ (requires Moderator permissions)",
			"*mod*: channel is visible to Moderator+ (requires Moderator permissions)",
			"*staff*: channel is visible to Staff+ (requires Staff permissions)",
			"*admin*: channel is visible to Admins (requires Admin permissions)"],
		callback: commandAddChannel
	},
	text: {
		minPermission: PERM_DIVISION_COMMANDER,
		args: ["<category>", "[<feed|guest|member|role|officer|mod|staff|admin>]", "[<roleName>]", "<name>"],
		helpText: ["Creates a text channel visible to Members+ by default.",
			"*feed*: channel is visible to everyone, but only Officer+ may send messages (requires Divivion Commander permissions)",
			"*guest*: channel is visible to everyone (requires Moderator permissions)",
			"*member*: channel is visible to Member+ (requires Officer permissions)",
			"*role*: channel is visible to a specific role (requires Divivion Commander permissions)",
			"*officer*: channel is visible to Officers+ (requires Moderator permissions)",
			"*mod*: channel is visible to Moderator+ (requires Moderator permissions)",
			"*staff*: channel is visible to Staff+ (requires Staff permissions)",
			"*admin*: channel is visible to Admins (requires Admin permissions)"],
		callback: commandAddChannel
	},
	setperms: {
		minPermission: PERM_STAFF,
		args: ["[<feed|guest|member|role|officer|mod|staff|admin>]", "[<roleName>]", "<name>"],
		helpText: ["Updates a channels permissions.",
			"*guest*: channel is visible to everyone (requires Moderator permissions)",
			"*member*: channel is visible to Member+ (requires Officer permissions)",
			"*role*: channel is visible to a specific role (requires Divivion Commander permissions)",
			"*officer*: channel is visible to Officers+ (requires Moderator permissions)",
			"*mod*: channel is visible to Moderator+ (requires Moderator permissions)",
			"*staff*: channel is visible to Staff+ (requires Staff permissions)",
			"*admin*: channel is visible to Admins (requires Admin permissions)"],
		callback: commandSetPerms
	},
	topic: {
		minPermission: PERM_MOD,
		args: ["[\"<channel>\"]", "<topic>"],
		helpText: "Sets the topic for a channel. If no channel is provided, the topic is set for the current channel.",
		callback: commandTopic
	},
	remchannel: {
		minPermission: PERM_DIVISION_COMMANDER,
		args: "<name>",
		helpText: "Removes a channel.",
		callback: commandRemChannel
	},
	rename: {
		minPermission: PERM_DIVISION_COMMANDER,
		args: ["[\"<channel>\"]", "<name>"],
		helpText: "Rename a channel.",
		callback: commandRenameChannel
	},
	up: {
		minPermission: PERM_STAFF,
		args: "<name>",
		helpText: "Moves a channel up.",
		callback: commandMoveChannel
	},
	down: {
		minPermission: PERM_STAFF,
		args: "<name>",
		helpText: "Moves a channel down.",
		callback: commandMoveChannel
	},
	adddivision: {
		minPermission: PERM_STAFF,
		args: "<name>",
		helpText: "Creates a division role and division channels with appropriate permissions.",
		callback: commandAddDivision
	},
	remdivision: {
		minPermission: PERM_STAFF,
		args: "<name>",
		helpText: "Removes a division and division channels.",
		callback: commandRemDivision
	},
	subroles: {
		minPermission: PERM_STAFF,
		args: ["<add|adda|rem|rema|create|createa|list|prune>", "<name>"],
		helpText: ["Manage subscribable roles.",
			"*add*: Add a role that members can self-subscribe to",
			"*adda*: Add a role that that can be assigned",
			"*rem*: Remove a role that members can self-subscribe to",
			"*rema*: Remove a role that that can be assigned",
			"*create*: Create a role that members can self-subscribe to",
			"*createa*: Create a role that that can be assigned",
			"*list*: List all managed roles",
			"*prune*: Prune roles that have been removed from discord",
		],
		callback: commandSubRoles
	},
	deproles: {
		minPermission: PERM_ADMIN,
		args: ["<set|unset|list|prune>", "<dependent role name>", "<required role name>"],
		helpText: ["Manage subscribable roles.",
			"*set*: Set a dependent role that will be assigned when the required role(s) is added",
			"*unset*: Unset a required role from a dependent role",
			"*list*: List all dependent roles",
			"*prune*: Prune roles that have been removed from discord",
		],
		callback: commandDependentRoles
	},
	purge: {
		minPermission: PERM_STAFF,
		args: "<num>",
		helpText: "Purges the last <num> messages from the channel the command was run in (1 <= num <= 100).",
		callback: commandPurge
	},
	forumsync: {
		minPermission: PERM_STAFF,
		args: ["<cmd>", "[<options>]"],
		helpText: ["Forum sync integration commands:",
			"*showmap*: Shows the current synchronization map",
			"*showroles*: Shows the discord roles eligible for integration",
			"*showforumgroups*: Shows the forum groups eligible for integration",
			"*sync*: Adds and removes members from discord roles based on forum groups",
			"*add \"<role>\" \"<group>\"*: Maps the forum <group> to the discord <role>",
			"*rem \"<role>\" \"<group>\"*: Removes the forum group from the map for the discord <role>",
			"*prune*: Remove invalid map entries"
		],
		callback: commandForumSync
	},
	/*showwebhooks: {
		minPermission: PERM_ADMIN,
		args: "",
		helpText: "Show current webhooks",
		callback: commandShowWebhooks
	},*/
	relay: {
		minPermission: PERM_ADMIN,
		args: ["[\"<channel>\"]", "[<message id>]", "\"<message>\""],
		helpText: "Relay a message using the bot. If <channel> is provided, the message will be sent there.",
		callback: commandRelay
	},
	react: {
		minPermission: PERM_ADMIN,
		args: ["\"<channel>\"", "<message id>", "\"<emoji>\""],
		helpText: "React to a message using the bot.",
		callback: commandReact
	},
	relaydm: {
		minPermission: PERM_ADMIN,
		args: ["[<@mention|tag|snowflake>]", "\"<message>\""],
		helpText: "Relay a DM using the bot.",
		callback: commandRelayDm
	},
	addadmin: {
		minPermission: PERM_OWNER,
		args: "<@mention|tag|snowflake>",
		helpText: "Add the Admin role to a user",
		callback: commandSetAdmin
	},
	remadmin: {
		minPermission: PERM_OWNER,
		args: "<@mention|tag|snowflake>",
		helpText: "Remove the Admin role from a user",
		callback: commandSetAdmin
	},
	reload: {
		minPermission: PERM_OWNER,
		args: "",
		helpText: "Reload the configuration",
		callback: commandReload,
		dmOnly: true
	},
	status: {
		minPermission: PERM_ADMIN,
		args: "",
		helpText: "Bot Status",
		callback: commandStatus,
		dmOnly: true
	},
	slap: {
		minPermission: PERM_GUEST,
		args: ["<@mention|tag|snowflake>", "[\"<object>\"]"],
		helpText: "Slap someone with a trout or optional object",
		callback: commandSlap,
		doLog: false
	},
	quit: {
		minPermission: PERM_OWNER,
		args: "",
		helpText: "Terminate the bot",
		callback: commandQuit,
		dmOnly: true
	},
	reloadcommands: {
		minPermission: PERM_OWNER,
		args: "",
		helpText: "Reload slash command files",
		callback: commandReloadCommands,
		dmOnly: true
	},
	reloadapi: {
		minPermission: PERM_OWNER,
		args: "",
		helpText: "Reload api and restart https server",
		callback: commandReloadAPI,
		dmOnly: true
	},
	test: {
		minPermission: PERM_OWNER,
		args: "",
		helpText: "Temporary command",
		callback: commandTest
	},
};

//process commands
function processCommand(message, member, cmd, arg_string, guild, perm, permName, isDM) {
	var commandObj = commands[cmd];
	if (commandObj !== undefined) {
		if (commandObj.minPermission <= perm) {
			var args = getParams(arg_string);
			if (commandObj.doLog !== false) {
				if (commandObj.logArgs !== false)
					console.log(`${getNameFromMessage(message)} executed: ${cmd} "${args.join('" "')}"`);
				else
					console.log(`${getNameFromMessage(message)} executed: ${cmd}`);
			}
			//if (commandObj.dmOnly === true && !isDM)
			//do nothing for now...
			return commandObj.callback(message, member, cmd, args, guild, perm, permName, isDM);
		}
	}
}
global.processCommand = processCommand;

//message event handler -- triggered when client receives a message from a text channel or DM
client.on("messageCreate", message => {
	//check for prefix
	if (!message.content.startsWith(config.prefix)) return;

	//make sure we have a member
	var isDM = false;
	var guild, role, perm, permName;
	var member = message.member;
	if (!member) {
		if (message.author.bot) {
			if (!message.webhookId || message.webhookId === '' || message.webhookId !== message.author.id)
				return; //ignore messages from bots that are not from authorized webhooks

			let webhookPerms = config.webHookPerms[message.webhookId];
			if (webhookPerms === undefined)
				return; //this bot is not allowed
			[perm, permName] = webhookPerms;

			if (message.channel && message.channel)
				guild = message.channel.guild;
			else
				guild = client.guilds.resolve(config.guildId);
			if (!guild)
				return; //must have guild
		} else {
			if (message.channel && message.channel.guild)
				guild = message.channel.guild;
			else
				guild = client.guilds.resolve(config.guildId);
			if (!guild)
				return; //must have guild

			member = guild.members.resolve(message.author.id);
			if (!member)
				return; //ignore messages from any real client that isn't in the guild

			message.member = member;
			isDM = true;
			[perm, permName] = getPermissionLevelForMember(member);
		}
	} else {
		guild = member.guild;
		if (!guild)
			return; //must have guild
		[perm, permName] = getPermissionLevelForMember(member);
	}

	//get command and argument string
	let first_space = message.content.indexOf(' ');
	var command, arg_string;
	if (first_space < 0) {
		command = message.content.slice(config.prefix.length).trim();
		arg_string = "";
	} else {
		command = message.content.slice(config.prefix.length, first_space);
		arg_string = message.content.slice(first_space + 1).trim();
	}

	try {
		return processCommand(message, member, command, arg_string, guild, perm, permName, isDM);
	} catch (error) {
		notifyRequestError(message, member, guild, error, (perm >= PERM_MOD));
	} //don't let user input crash the bot
});

function parseInteractionData(option) {
	if (option.type == 1 || option.type == 2) { //subcommand/group
		let cmd = [option.name];
		let options = [];
		option.options.forEach(o => {
			let parsed = parseInteractionData(o);
			cmd = cmd.concat(parsed.cmd);
			options = options.concat(parsed.options);
		});
		return { cmd: cmd, options: options };
	} else {
		return { cmd: [], options: [`${option.name}: "${option.value}"`] };
	}
}

function logInteraction(command, interaction) {
	if (command.noLog === true)
		return;
	let cmd = [interaction.commandName];
	let options = [];
	if (interaction.isContextMenuCommand()) {
		options.push(interaction.targetId);
	} else {
		interaction.options.data.forEach(o => {
			let parsed = parseInteractionData(o);
			cmd = cmd.concat(parsed.cmd);
			options = options.concat(parsed.options);
		});
	}

	cmd = '["' + cmd.join('" > "') + '"]';
	options = command.noOptionsLog === true ? '' : ' options:[' + options.join(', ') + ']';
	console.log(`${getNameFromMessage(interaction)} executed: cmd:${cmd}${options}`);
}

//Slash Command Processing
function loadSlashCommands() {
	try {
		if (client.commands)
			delete client.commands;
		client.commands = new Collection();
		const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
		for (const file of commandFiles) {
			try {
				delete require.cache[require.resolve(`./commands/${file}`)];
			} catch (error) {}
			const command = require(`./commands/${file}`);
			client.commands.set(command.data.name, command);
		}
	} catch (error) {
		console.log(error);
	}
}
loadSlashCommands();
client.on('interactionCreate', async interaction => {
	let command;
	let commandName;
	if (interaction.isButton()) {
		if (!interaction.customId.startsWith('::')) {
			//generic buttons handled through collectors
			return;
		}
		let args = interaction.customId.split('::');
		if (args.length < 3) {
			return;
		}
		args.shift(); //first is empty
		commandName = args.shift();
		command = client.commands.get(commandName);
	} else {
		commandName = interaction.commandName;
		command = client.commands.get(interaction.commandName);
	}
	if (!command) {
		console.error(`${commandName} not found`);
		return;
	}

	let member;
	if (!interaction.inGuild()) {
		interaction.reply("Not supported");
		return;
		/*let guild = client.guilds.resolve(config.guildId);
		member = guild.members.resolve(interaction.user.id);
		if (!member) {
			interaction.reply("You are not a member of the AOD server.");
			return;
		}*/
		//FIXME interaction.guild and interaction.member are readonly
	} else {
		member = interaction.member;
	}
	let [perm, permName] = getPermissionLevelForMember(member);

	interaction.isInteraction = true;
	if (interaction.isChatInputCommand()) {
		if (command.execute === undefined) {
			console.log(`No execute callback defined for ${commandName}`);
			return;
		}
		if (command.checkPerm !== undefined) {
			const subCommandGroup = interaction.options.getSubcommandGroup(false);
			const subCommand = interaction.options.getSubcommand(false);
			let result = false;
			if (subCommand) {
				result = command.checkPerm(perm, subCommand, subCommandGroup);
			} else {
				result = command.checkPerm(perm, commandName);
			}
			if (!result) {
				return ephemeralReply(interaction, 'You do not have permission for this command');
			}
		}
		try {
			logInteraction(command, interaction);
			await command.execute(interaction, member, perm, permName);
			if (!interaction.replied)
				ephemeralReply(interaction, "Done");
		} catch (error) {
			console.error(error);
			try {
				ephemeralReply(interaction, 'There was an error while executing your command');
			} catch (error) {}
		}
	} else if (interaction.isAutocomplete()) {
		if (command.autocomplete === undefined) {
			console.log(`No autocomplete callback defined for ${commandName}`);
			return;
		}
		try {
			await command.autocomplete(interaction, member, perm, permName);
			if (!interaction.responded)
				interaction.respond([]);
		} catch (error) {
			console.error(error);
			if (!interaction.responded)
				interaction.respond([]);
		}
	} else if (interaction.isButton()) {
		if (command.button === undefined) {
			console.log(`No button callback defined for ${commandName}`);
			return;
		}
		try {
			await command.button(interaction, member, perm, permName);
			if (!interaction.replied)
				ephemeralReply(interaction, "Done");
		} catch (error) {
			console.error(error);
			try {
				ephemeralReply(interaction, 'There was an error processing this action.');
			} catch (error) {}
		}
	} else if (interaction.isContextMenuCommand()) {
		if (command.menu === undefined) {
			console.log(`No menu callback defined for ${commandName}`);
			return;
		}
		if (command.checkMenuPerm !== undefined) {
			let result = command.checkMenuPerm(perm, commandName);
			if (!result) {
				return ephemeralReply(interaction, 'You do not have permission for this menu option');
			}
		}
		try {
			logInteraction(command, interaction);
			await command.menu(interaction, member, perm, permName);
			if (!interaction.replied)
				sendInteractionReply(interaction, { content: "Done", ephemeral: true });
		} catch (error) {
			console.error(error);
			try {
				ephemeralReply(interaction, 'There was an error while executing your command');
			} catch (error) {}
		}
	} else {
		try {
			console.error(`Unknown interaction type ${interaction.type}`);
			if (interaction.isRepliable()) {
				ephemeralReply(interaction, 'Unknown interaction type');
			}
		} catch (error) {}
	}
});

var voiceStatusUpdates = {};

function tempChannelCreatedBy(channelId) {
	if (joinToCreateChannels.tempChannels[channelId]) {
		return joinToCreateChannels.tempChannels[channelId];
	}
	return null;
}
global.tempChannelCreatedBy = tempChannelCreatedBy;

//voiceStateUpdate event handler -- triggered when a user joins or leaves a channel or their status in the channel changes
client.on('voiceStateUpdate', async function(oldMemberState, newMemberState) {
	if (oldMemberState.channelId != newMemberState.channelId) {
		const guild = oldMemberState.guild;
		//user changed channels
		if (oldMemberState.channel) {
			if (joinToCreateChannels.tempChannels[oldMemberState.channelId]) {
				//user left temp channel created by join-to-create
				if (oldMemberState.channel.members.size === 0) {
					oldMemberState.channel.delete();
					delete joinToCreateChannels.tempChannels[oldMemberState.channelId];
					fs.writeFileSync(config.joinToCreateChannels, JSON.stringify(joinToCreateChannels), 'utf8');
				}
			} else {
				const oldCategory = guild.channels.resolve(oldMemberState.channel.parentId);
				if (oldCategory && oldCategory.name === config.tempChannelCategory) {
					//user left temp channel in the global category
					if (oldMemberState.channel.members.size === 0) {
						oldMemberState.channel.delete();
					}
				}
			}
		}
		if (newMemberState.channel) {
			if (joinToCreateChannels.joinToCreateChannels[newMemberState.channelId] === 1) {
				//user joined a join-to-create channel; create a new channel with the same parent and move the user to it
				let perm = getPermissionLevelForMember(newMemberState.member);
				if (perm < PERM_MEMBER) {
					sendMessageToMember(newMemberState.member, 'You do not have permissions to create voice channels');
					newMemberState.disconnect().catch(error => {});
				} else {
					//FIXME what what if the member creates mulitple channels?
					let tempChannelName = `${newMemberState.member.nickname}'s Channel`;
					let type = 'voice';
					let level = 'member';
					let category = guild.channels.resolve(newMemberState.channel.parentId);
					let officerRoleName = category.name + ' ' + config.discordOfficerSuffix;
					let officerRole = guild.roles.cache.find(r => { return r.name == officerRoleName; });
					let tempChannel = await addChannel(guild, null, newMemberState.member, perm, tempChannelName, type, level,
						category, officerRole, null, newMemberState.member);
					if (tempChannel) {
						newMemberState.member.voice.setChannel(tempChannel).catch(error => {});
						joinToCreateChannels.tempChannels[tempChannel.id] = newMemberState.member.id;
						fs.writeFileSync(config.joinToCreateChannels, JSON.stringify(joinToCreateChannels), 'utf8');
					} else {
						sendMessageToMember(newMemberState.member, 'Failed to create voice channel');
						newMemberState.disconnect().catch(error => {});
					}
				}
			}
			voiceStatusUpdates[newMemberState.member.id] = (new Date()).getTime();
		}
	}
});

function convertDiscordTag(discordTag) {
	return discordTag.replace(/[^ -~]/gu, function(c) {
		return `\&#${c.codePointAt()};`;
	});
}

//get forum group for guild member
function getForumGroupsForMember(member) {
	let promise = new Promise(function(resolve, reject) {
		let db = connectToDB();
		let query =
			`SELECT u.userid,u.username,f.field19,f.field20,u.usergroupid,u.membergroupids FROM ${config.mysql.prefix}user AS u ` +
			`INNER JOIN ${config.mysql.prefix}userfield AS f ON u.userid=f.userid ` +
			`WHERE f.field20="${member.user.id}" OR f.field19 LIKE "${convertDiscordTag(member.user.tag)}"`;
		db.query(query, function(err, rows, fields) {
			if (err)
				reject(err);
			else {
				if (rows === undefined || rows.length === 0) {
					return resolve();
				}
				if (rows.length > 1) { //danger will robinson! name conflict in database
					member.send("Hello AOD member! There is a conflict with your discord name. Please verify your profile and contact the leadership for help.").catch(() => {});
					return reject(`Member name conflict: ${rows.length} members have the discord tag ${member.user.tag}`);
				}

				let row = rows.shift();
				let forumGroups = [];
				if (row.usergroupid !== undefined)
					forumGroups.push(row.usergroupid);
				if (row.membergroupids !== undefined)
					forumGroups = forumGroups.concat(row.membergroupids.split(','));
				return resolve({ name: row.username, groups: forumGroups });
			}
		});
	});
	return promise;
}

function setRolesForMember(member, reason) {
	let promise = new Promise(function(resolve, reject) {
		getForumGroupsForMember(member)
			.then(async function(data) {
				if (data === undefined || data.groups.length === 0) {
					await member.send(`Hello ${member.displayName}! Welcome to the ClanAOD.net Discord. Roles in our server are based on forum permissions. Use \`${config.prefix}login\` to associate your Discord user to our forums (https://www.clanaod.net).`).catch(() => {});
					resolve();
					return;
				}

				let rolesByGroup = getRolesByForumGroup(member.guild);
				let rolesToAdd = [],
					existingRoles = [];
				for (var i in data.groups) {
					var group = data.groups[i];
					if (rolesByGroup[group] !== undefined) {
						for (const roleName of Object.keys(rolesByGroup[group])) {
							let role = rolesByGroup[group][roleName];
							if (role) {
								if (!member.roles.cache.get(role.id))
									rolesToAdd.push(role);
								else
									existingRoles.push(role);
							}
						}
					}
				}
				if (rolesToAdd.length) {
					try {
						await member.roles.add(rolesToAdd, reason);
					} catch (error) {
						reject();
						return;
					}
				} else if (!existingRoles.length) {
					await member.send(`Hello ${member.displayName}! Welcome to the ClanAOD.net Discord. Roles in our server are based on forum permissions. Use \`${config.prefix}login\` in a DM the to associate your Discord user to our forums (https://www.clanaod.net). \`${config.prefix}help login\` can provide more details.`).catch(() => {});
					resolve();
					return;
				}

				if (member.displayName !== data.name) {
					try {
						await member.setNickname(data.name, reason);
					} catch (error) {}
				}
				let roles = existingRoles.concat(rolesToAdd);
				await member.send(`Hello ${data.name}! The following roles have been granted: ${roles.map(r=>r.name).join(', ')}. Use \`!help\` to see available commands.`).catch(() => {});
				resolve();
			})
			.catch(error => {
				notifyRequestError(null, member, guild, error, false);
				reject();
			});
	});
	return promise;
}

//guildMemberAdd event handler -- triggered when a user joins the guild
client.on('guildMemberAdd', member => {
	setRolesForMember(member, 'First time join');
});

function checkAddDependentRoles(guild, role, member) {
	let roleId = '' + role.id;
	if (dependentRoles.requiredFor[roleId] !== undefined) {
		let potentialRoleIDs = dependentRoles.requiredFor[roleId];
		for (let i = 0; i < potentialRoleIDs.length; i++) {
			if (roleId === potentialRoleIDs[i]) {
				//recursive add???
				continue;
			}
			let requiredRoleIDs = dependentRoles.requires[potentialRoleIDs[i]];
			let add = true;
			for (let j = 0; j < requiredRoleIDs.length; j++) {
				if (roleId === requiredRoleIDs[j]) {
					continue; //just added; skip
				}
				if (!member.roles.resolve(requiredRoleIDs[j])) {
					add = false;
					break;
				}
			}
			if (add) {
				//all roles are present
				addRemoveRole(null, guild, true, potentialRoleIDs[i], member, true);
			}
		}
	}
}

function checkRemoveDependentRoles(guild, role, member) {
	let roleId = '' + role.id;
	if (dependentRoles.requiredFor[roleId] !== undefined) {
		let requiredForIDs = dependentRoles.requiredFor[roleId];
		for (let i = 0; i < requiredForIDs.length; i++) {
			if (roleId === requiredForIDs[i]) {
				//recursive remove???
				continue;
			}
			addRemoveRole(null, guild, false, requiredForIDs[i], member, true);
		}
	}
}

client.on('guildMemberUpdate', (oldMember, newMember) => {
	const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
	removedRoles.forEach(r => {
		//console.log(`${r.name} removed from ${newMember.user.tag}`);
		checkRemoveDependentRoles(newMember.guild, r, newMember);
	});
	const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
	addedRoles.forEach(r => {
		//console.log(`${r.name} added to ${newMember.user.tag}`);
		checkAddDependentRoles(newMember.guild, r, newMember);
	});
});

var forumSyncTimer = null;
var lastDate = null;

function forumSyncTimerCallback() {
	global.lastForumSync = new Date();
	let currentDate = `${global.lastForumSync.getFullYear()}/${global.lastForumSync.getMonth()+1}/${global.lastForumSync.getDate()}`;
	const guild = client.guilds.resolve(config.guildId);
	let doDaily = false;

	//console.log(`Forum sync timer called; currentDate=${currentDate} lastDate=${lastDate}`);

	if (lastDate !== null && lastDate !== currentDate)
		doDaily = true;
	lastDate = currentDate;
	doForumSync(null, null, guild, PERM_NONE, doDaily);
	if (doDaily)
		guild.members.prune({ days: 14, reason: 'Forum sync timer' })
		.catch(error => { notifyRequestError(null, null, guild, error, false); });

	//clearout expired login errors
	let currEpochMs = (new Date()).getTime();
	for (var id in loginErrorsByUserID) {
		if (loginErrorsByUserID.hasOwnProperty(id)) {
			let loginError = loginErrorsByUserID[id];
			if ((loginError.epochMs + config.forumLoginErrorTimeoutMs) < currEpochMs) {
				//console.log(`deleting error for ${member.user.tag} in timer`);
				delete loginErrorsByUserID[id];
			}
		}
	}
}

//messageDelete handler
client.on('messageDelete', (message) => {
	if (message.guildId && message.channel && message.content && !message.content.startsWith(config.prefix + 'relay ') &&
		!message.content.startsWith(config.prefix + 'relaydm ') && !message.content.startsWith(config.prefix + 'react ') &&
		!message.content.startsWith(config.prefix + 'login '))
		console.log(`Deleted message from ${message.author.tag} in #${message.channel.name}: ${message.content}`);
});

//channelDelete handler
client.on('channelDelete', (channel) => {
	if (joinToCreateChannels.joinToCreateChannels[channel.id]) {
		delete joinToCreateChannels.joinToCreateChannels[channel.id];
		fs.writeFileSync(config.joinToCreateChannels, JSON.stringify(joinToCreateChannels), 'utf8');
	} else if (joinToCreateChannels.tempChannels[channel.id]) {
		delete joinToCreateChannels.tempChannels[channel.id];
		fs.writeFileSync(config.joinToCreateChannels, JSON.stringify(joinToCreateChannels), 'utf8');
	}
});

//ready handler
client.on("ready", async function() {
	//remove any empty temp channels
	const guild = client.guilds.resolve(config.guildId);
	console.log(`Bot has started, with ${client.users.cache.size} users, in ${client.channels.cache.size} channels of ${client.guilds.cache.size} guilds.`);

	await guild.members.fetch()
		.catch(error => { console.log(error); });
	await guild.roles.fetch()
		.catch(error => { console.log(error); });
	await guild.commands.fetch()
		.catch(error => { console.log(error); });
	console.log(`Member fetch complete`);

	const tempChannelCategory = guild.channels.cache.find(c => { return c.name === config.tempChannelCategory; });
	if (tempChannelCategory && tempChannelCategory.children && tempChannelCategory.children.size) {
		tempChannelCategory.children.forEach(function(c) {
			if (c.type == ChannelType.GuildVoice) {
				if (c.members.size === 0)
					c.delete();
			}
		});
	}

	for (let joinToCreateChannel in joinToCreateChannels.joinToCreateChannels) {
		if (joinToCreateChannels.joinToCreateChannels.hasOwnProperty(joinToCreateChannel)) {
			const channel = guild.channels.resolve(joinToCreateChannel);
			if (!channel) {
				delete joinToCreateChannels.joinToCreateChannels[joinToCreateChannel];
			}
		}
	}
	for (let tempChannel in joinToCreateChannels.tempChannels) {
		if (joinToCreateChannels.tempChannels.hasOwnProperty(tempChannel)) {
			const channel = guild.channels.resolve(tempChannel);
			if (!channel) {
				delete joinToCreateChannels.tempChannels[tempChannel];
			} else if (channel.members.size === 0) {
				channel.delete();
			}
		}
	}
	fs.writeFileSync(config.joinToCreateChannels, JSON.stringify(joinToCreateChannels), 'utf8');

	forumSyncTimerCallback(); //prime the date and do initial adds
	forumSyncTimer = setInterval(forumSyncTimerCallback, config.forumSyncIntervalMS);

	startNextSavedTimer();
});


//guildCreate handler -- triggers when the bot joins a server for the first time
client.on("guildCreate", guild => {
	console.log(`New guild joined: ${guild.name} (id: ${guild.id}). This guild has ${guild.memberCount} members!`);
});

//guildCreate handler -- triggers when the bot leaves a server
client.on("guildDelete", guild => {
	console.log(`I have been removed from: ${guild.name} (id: ${guild.id})`);
});

//common client error handler
client.on('error', error => { notifyRequestError(null, null, null, error, false); });

//everything is defined, start the client
client.login(config.token)
	.catch(console.error);

startAPIServer();
