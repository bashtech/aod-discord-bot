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
	InteractionType,
	OverwriteType,
	AuditLogEvent,
	Events,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	GuildOnboardingPromptType
} = require('discord.js');

//include node-fetch using esm-hook
const fetch = require('node-fetch').default;

//include entities
const htmlEntitiesDecode = require('html-entities').decode;

//include sprintf-js
const sprintf = require('sprintf-js').sprintf;
//const vsprintf = require('sprintf-js').vsprintf;

//include config
var config = require('./config/aod-discord-bot.config.json');
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
global.forumIntegrationConfig = forumIntegrationConfig;

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

//Notification channel
var globalNotificationChannel;

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
		if (groupMap.roleID === undefined || groupMap.roleID === '') {
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
	mysqlConnection = mysql.createConnection(config.mysql.config);
	mysqlConnection.connect(error => {
		if (error)
			console.log(error);
	});
	mysqlConnection
		.on('close', error => {
			if (error) {
				console.log(error);
				connectToDB();
			}
		})
		.on('error', error => {
			console.log(error);
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
		if (message.user)
			return message.user.tag;
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

function sendInteractionReply(interaction, data, edit) {
	if (interaction.replied) {
		if (edit === true)
			return interaction.editReply(data).catch(() => {});
		else
			return interaction.followUp(data).catch(() => {});
	} else if (interaction.deferred) {
		return interaction.editReply(data).catch(() => {});
	} else {
		return interaction.reply(data)
			.then(() => { interaction.replied = true; })
			.catch(() => {});
	}
}
global.sendInteractionReply = sendInteractionReply;

function ephemeralReply(message, msg, edit) {
	if (message) {
		if (message.isInteraction) {
			if (typeof(msg) === 'object') {
				if (msg.embeds !== undefined || msg.components !== undefined || msg.content !== undefined) {
					msg.ephemeral = true;
					return sendInteractionReply(message, msg, edit);
				} else {
					return sendInteractionReply(message, { embeds: [msg], ephemeral: true }, edit);
				}
			} else {
				return sendInteractionReply(message, { content: msg, ephemeral: true }, edit);
			}
		} else {
			if (typeof(msg) === 'object')
				return message.reply(message, { embeds: [msg] }).catch(() => {});
			else
				return message.reply(msg).catch(() => {});
		}
	}
	return Promise.resolve();
}
global.ephemeralReply = ephemeralReply;

function messageReply(message, msg, edit) {
	if (message) {
		if (message.isInteraction) {
			if (typeof(msg) === 'object') {
				if (msg.embeds !== undefined || msg.components !== undefined || msg.content !== undefined) {
					return sendInteractionReply(message, msg, edit);
				} else {
					return sendInteractionReply(message, { embeds: [msg] }, edit);
				}
			} else {
				return sendInteractionReply(message, { content: msg }, edit);
			}
		} else {
			if (typeof(msg) === 'object')
				return message.reply(message, { embeds: [msg] }).catch(() => {});
			else
				return message.reply(msg).catch(() => {});
		}
	}
	return Promise.resolve();
}
global.messageReply = messageReply;

function sendGlobalNotification(guild, msg) {
	if (guild) {
		if (!globalNotificationChannel || globalNotificationChannel.name !== config.globalNotificationChannel) {
			globalNotificationChannel = guild.channels.cache.find(c => { return c.name === config.globalNotificationChannel; });
		}
		if (typeof(msg) === 'object')
			return globalNotificationChannel.send({ embeds: [msg] }).catch(() => {});
		else
			return globalNotificationChannel.send(msg).catch(() => {});
	}
	return Promise.resolve();
}
global.sendGlobalNotification = sendGlobalNotification;

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
		return ephemeralReply(message, `Invalid Role: ${roleData}`);
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
				console.log(error);
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
				console.log(error);
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
global.getStringForPermission = getStringForPermission;

//map roles to permissions based on config
function getPermissionLevelForMember(guild, member) {
	if (member.permissions.bitfield & PermissionsBitField.Flags.Administrator) {
		if (guild.ownerId === member.id || (config.ownerIds && config.ownerIds[member.id]))
			return PERM_OWNER;
		return PERM_ADMIN;
	}
	//if (member.roles.cache.find(r => config.adminRoles.includes(r.name)))
	if (member.permissions.bitfield & PermissionsBitField.Flags.ManageRoles)
		return PERM_ADMIN;
	//if (member.roles.cache.find(r => config.staffRoles.includes(r.name)))
	if (member.permissions.bitfield & PermissionsBitField.Flags.ViewAuditLog)
		return PERM_STAFF;

	let perm = PERM_GUEST;
	//if (member.roles.cache.find(r => config.modRoles.includes(r.name)))
	if (member.permissions.bitfield & PermissionsBitField.Flags.KickMembers)
		perm = PERM_MOD;
	//if (member.roles.cache.find(r => r.name == config.memberRole))
	else if (member.permissions.bitfield & PermissionsBitField.Flags.UseExternalEmojis)
		perm = PERM_MEMBER;
	for (let [roleId, role] of member.roles.cache) {
		if ((perm < PERM_DIVISION_COMMANDER) && config.divisionCommandRoles.includes(role.name))
			return PERM_DIVISION_COMMANDER; //highest after staff, just return now
		if ((perm < PERM_RECRUITER) && (role.name.endsWith('Officer') || config.recruiterRoles.includes(role.name)))
			perm = PERM_RECRUITER;
		//if (perm < PERM_GUEST && role.name == config.guestRole)
		//	perm = PERM_GUEST;
	}
	return perm;
}
global.getPermissionLevelForMember = getPermissionLevelForMember;

function getPermissionLevelForRole(guild, role) {
	if (role.permissions.bitfield & PermissionsBitField.Flags.Administrator)
		return PERM_ADMIN;
	//if (config.adminRoles.includes(role.name))
	if (role.permissions.bitfield & PermissionsBitField.Flags.ManageRoles)
		return PERM_ADMIN;
	//if (config.staffRoles.includes(role.name))
	if (role.permissions.bitfield & PermissionsBitField.Flags.ViewAuditLog)
		return PERM_STAFF;
	if (config.divisionCommandRoles.includes(role.name))
		return PERM_DIVISION_COMMANDER;
	//if (config.modRoles.includes(role.name))
	if (role.permissions.bitfield & PermissionsBitField.Flags.KickMembers)
		return PERM_MOD;
	if (role.name.endsWith('Officer') || config.recruiterRoles.includes(role.name))
		return PERM_RECRUITER;
	if (role.name == config.memberRole)
		return PERM_MEMBER;
	//if (role.name == config.guestRole)
	//	return PERM_GUEST;
	return PERM_GUEST;
}
global.getPermissionLevelForRole = getPermissionLevelForRole;

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

function sendMessageToMember(member, msg) {
	if (member) {
		if (typeof(msg) === 'object') {
			if (msg.embeds !== undefined || msg.components !== undefined || msg.content !== undefined) {
				return member.send(msg).catch(() => {});
			} else {
				return member.send({ embeds: [msg] }).catch(() => {});
			}
		} else {
			return member.send(msg).catch(() => {});
		}
	}
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
	let count = 0;
	for (let desc of list) {
		count++;
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
	if (count == 0)
		embed.description = '<None>';
	if (embed.description.length)
		return sendReplyToMessageAuthor(message, member, { embeds: [embed] });
	return Promise.resolve();
}

//help command processing
function commandHelp(message, member, cmd, args, guild, perm, isDM) {
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

function commandReminder(message, member, cmd, args, guild, perm, isDM) {
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

function getLoginToken(member) {
	let promise = new Promise(function(resolve, reject) {
		let db = connectToDB();
		let currEpoch = ((new Date()).getTime()) / 1000;
		let validEpoch = currEpoch - 15 * 60; //15 minutes

		let query =
			`SELECT token, create_time ` +
			`FROM ${config.mysql.discordPrefix}discord_login_tokens ` +
			`WHERE used = 0 AND create_time > ${validEpoch} ` +
			`  AND discord_id="${member.id}"`;
		db.query(query, function(err, rows, fields) {
			if (err) {
				console.log(err);
				return reject();
			}
			if (rows.length)
				return resolve(rows[0].token);
			//no existing token
			let token = md5(currEpoch + member.id + Math.random().toString());
			let tag = db.escape(convertDiscordTag(member.user.tag));
			query =
				`INSERT INTO ${config.mysql.discordPrefix}discord_login_tokens ` +
				`  (token, create_time, discord_tag, discord_id, used) ` +
				`VALUES ` +
				`  ("${token}",${currEpoch},${tag},"${member.user.id}",0)`;
			db.query(query, function(err, results, fields) {
				if (err) {
					console.log(err);
					return reject();
				}
				resolve(token);
			});
		});
	});
	return promise;
}
global.getLoginToken = getLoginToken;

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

	let promise = new Promise(function(resolve, reject) {
		let db = connectToDB();
		let password_md5 = db.escape(md5(password));
		let esc_username = db.escape(username);
		let query = `CALL check_user(${esc_username},${password_md5})`;
		db.query(query, async function(err, results, fields) {
			let success = false;
			if (!err) {
				//rows[i].userid
				//rows[i].username
				//rows[i].valid
				//should never be more than 1 user...
				if (results && results.length && results[0].length) {
					let data = results[0][0];
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
								const notificationChannel = guild.channels.cache.find(c => { return c.name === config.globalNotificationChannel; });
								console.log(`Existing forum account found ${data2.username} ${data2.userid}`);
								if (notificationChannel) {
									await notificationChannel.send(`${member.user.tag} logged in as ${data.username} but was already known as ${data2.username}`).catch(() => {});
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
							await setRolesForMember(guild, member, "Forum login");
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
async function commandLogin(message, member, cmd, args, guild, perm, isDM) {
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

//purge command processing
function commandPurge(message, member, cmd, args, guild, perm, isDM) {
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

var channelPermissionLevels = ['public', 'feed', 'guest', 'member', 'role', 'officer', 'mod', 'staff', 'admin'];
var FlagSetVoiceChannelStatus = 1n << 48n; //FIXME Replace with officiel flag

async function getChannelPermissions(guild, message, perm, level, type, divisionOfficerRole, additionalRole, targetMember) {
	let promise = new Promise(async function(resolve, reject) {
		//@everyone permissions
		let defaultAllow = [];
		let defaultDeny = [
			PermissionsBitField.Flags.ViewChannel,
			PermissionsBitField.Flags.Connect
		];
		//default role permissions
		let allow = [
			PermissionsBitField.Flags.ViewChannel,
			PermissionsBitField.Flags.Connect
		];
		let deny = [];
		if (type === 'ptt')
			defaultDeny.push(PermissionsBitField.Flags.UseVAD);
		let officerAllow = allow.concat([
			PermissionsBitField.Flags.ManageMessages,
			PermissionsBitField.Flags.MoveMembers,
			PermissionsBitField.Flags.ManageEvents,
			PermissionsBitField.Flags.CreateEvents,
			FlagSetVoiceChannelStatus
		]);
		let memberAllow = allow.concat([
			FlagSetVoiceChannelStatus
		]);

		var permissions;
		switch (level) {
			case 'public': {
				if (type === 'ptt')
					defaultDeny = [PermissionsBitField.Flags.UseVAD];
				else
					defaultDeny = [];
				if (perm < PERM_MOD) {
					await ephemeralReply(message, "You don't have permissions to add this channel type");
					return resolve(null);
				}

				permissions = getPermissionsForEveryone(guild, defaultAllow, defaultDeny, allow, deny);
				//add role permissions
				if (divisionOfficerRole) {
					permissions = addRoleToPermissions(guild, divisionOfficerRole, permissions, officerAllow, deny);
				}
				if (targetMember) {
					permissions = addMemberToPermissions(guild, targetMember, permissions, memberAllow, deny);
				}
				break;
			}
			case 'guest': {
				if (perm < PERM_MOD) {
					await ephemeralReply(message, "You don't have permissions to add this channel type");
					return resolve(null);
				}

				permissions = getPermissionsForGuest(guild, defaultAllow, defaultDeny, allow, deny);
				//add role permissions
				if (divisionOfficerRole) {
					permissions = addRoleToPermissions(guild, divisionOfficerRole, permissions, officerAllow, deny);
				}
				if (targetMember) {
					permissions = addMemberToPermissions(guild, targetMember, permissions, memberAllow, deny);
				}
				break;
			}
			case 'mod': {
				if (perm < PERM_MOD) {
					await ephemeralReply(message, "You don't have permissions to add this channel type");
					return resolve(null);
				}
				permissions = getPermissionsForModerators(guild, defaultAllow, defaultDeny, allow, deny);
				break;
			}
			case 'officer': {
				if (perm < PERM_MOD) {
					await ephemeralReply(message, "You don't have permissions to add this channel type");
					return resolve(null);
				}
				if (!divisionOfficerRole) {
					await ephemeralReply(message, "No officer role could be determined");
					return resolve(null);
				}
				permissions = getPermissionsForModerators(guild, defaultAllow, defaultDeny, allow, deny);
				permissions = addRoleToPermissions(guild, divisionOfficerRole, permissions, [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect]);
				break;
			}
			case 'staff': {
				if (perm < PERM_STAFF) {
					await ephemeralReply(message, "You don't have permissions to add this channel type");
					return resolve(null);
				}
				permissions = getPermissionsForStaff(guild, defaultAllow, defaultDeny, allow, deny);
				break;
			}
			case 'admin': {
				if (perm < PERM_ADMIN) {
					await ephemeralReply(message, "You don't have permissions to add this channel type");
					return resolve(null);
				}
				permissions = getPermissionsForAdmin(guild, defaultAllow, defaultDeny, allow, deny);
				break;
			}
			case 'feed': {
				defaultDeny = [PermissionsBitField.Flags.SendMessages];
				if (type !== 'text') {
					await ephemeralReply(message, "Feed may only be used for text channels");
					return resolve(null);
				}
				if (perm < PERM_DIVISION_COMMANDER) {
					await ephemeralReply(message, "You don't have permissions to add this channel type");
					return resolve(null);
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
				//add officer permissions
				if (divisionOfficerRole) {
					officerAllow.push(PermissionsBitField.Flags.SendMessages);
					permissions = addRoleToPermissions(guild, divisionOfficerRole, permissions, officerAllow, deny);
				}
				break;
			}
			case 'role': {
				//get permissions for moderators
				permissions = getPermissionsForModerators(guild, defaultAllow, defaultDeny, allow, deny);
				//add officer permissions
				if (divisionOfficerRole) {
					permissions = addRoleToPermissions(guild, divisionOfficerRole, permissions, officerAllow, deny);
				}
				//add role permissions
				if (additionalRole) {
					permissions = addRoleToPermissions(guild, additionalRole, permissions, allow, deny);
				}
				//add target member permissions
				if (targetMember) {
					permissions = addMemberToPermissions(guild, targetMember, permissions, memberAllow, deny);
				}
				break;
			}
			case 'role-feed': {
				defaultDeny.push(PermissionsBitField.Flags.SendMessages);
				if (type !== 'text') {
					await ephemeralReply(message, "Feed may only be used for text channels");
					return resolve(null);
				}
				if (perm < PERM_DIVISION_COMMANDER) {
					await ephemeralReply(message, "You don't have permissions to add this channel type");
					return resolve(null);
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
				//add officer permissions
				if (divisionOfficerRole) {
					officerAllow.push(PermissionsBitField.Flags.SendMessages);
					permissions = addRoleToPermissions(guild, divisionOfficerRole, permissions, officerAllow, deny);
				}
				//add role permissions
				if (additionalRole) {
					permissions = addRoleToPermissions(guild, additionalRole, permissions, allow, deny);
				}
				break;
			}
			default: { //member
				permissions = getPermissionsForMembers(guild, defaultAllow, defaultDeny, allow, deny);
				//add officer permissions
				if (divisionOfficerRole) {
					permissions = addRoleToPermissions(guild, divisionOfficerRole, permissions, officerAllow, deny);
				}
				//add target member permissions
				if (targetMember) {
					permissions = addMemberToPermissions(guild, targetMember, permissions, memberAllow, deny);
				}
				break;
			}
		}
		resolve(permissions);
	});
	return promise;
}

function getPermissionDetails(permBitField) {
	return {
		view: permBitField.has(PermissionsBitField.Flags.ViewChannel),
		connect: permBitField.has(PermissionsBitField.Flags.Connect),
		send: permBitField.has(PermissionsBitField.Flags.SendMessages),
		manage: permBitField.has(PermissionsBitField.Flags.ManageMessages)
	};
}

function getChannelRole(guild, channel) {
	const subRoles = getUserRoles(false);
	let channelRole;
	let overwrite = channel.permissionOverwrites.cache.find(o => {
		if (o.type === OverwriteType.Role) {
			let role = guild.roles.resolve(o.id);
			if (role) {
				if (subRoles.includes(role.name)) {
					channelRole = role;
					return true;
				}
			}
		}
		return false;
	});
	return channelRole;
}

function getChannelInfo(guild, channel) {
	let promise = new Promise(async function(resolve, reject) {
		const guestRole = guild.roles.cache.find(r => { return r.name == config.guestRole; });
		const memberRole = guild.roles.cache.find(r => { return r.name == config.memberRole; });
		const modRole = guild.roles.cache.find(r => { return r.name == config.modRoles[0]; });
		const staffRole = guild.roles.cache.find(r => { return r.name == config.staffRoles[0]; });
		//const adminRole = guild.roles.cache.find(r => { return r.name == config.adminRoles[0]; });

		let officerRole;
		let divisionMemberRole;
		let divisionRole;
		if (channel.parent) {
			let officerRoleName = channel.parent.name + ' ' + config.discordOfficerSuffix;
			officerRole = guild.roles.cache.find(r => { return r.name == officerRoleName; });
			let memberRoleName = channel.parent.name + ' ' + config.discordMemberSuffix;
			divisionMemberRole = guild.roles.cache.find(r => { return r.name == memberRoleName; });
			divisionRole = guild.roles.cache.find(r => { return r.name == channel.parent.name; });
		}

		let channelRole;
		if (!divisionRole) {
			channelRole = getChannelRole(guild, channel);
		}

		const everyonePerms = await channel.permissionsFor(guild.roles.everyone);
		const guestPerms = await channel.permissionsFor(guestRole);
		const memberPerms = await channel.permissionsFor(memberRole);
		const channelRolePerms = (channelRole ? await channel.permissionsFor(channelRole) : null);
		const officerPerms = (officerRole ? await channel.permissionsFor(officerRole) : null);
		const divisionMemberPerms = (divisionMemberRole ? await channel.permissionsFor(divisionMemberRole) : null);
		const divisionPerms = (divisionRole ? await channel.permissionsFor(divisionRole) : null);
		const modPerms = await channel.permissionsFor(modRole);
		const staffPerms = await channel.permissionsFor(staffRole);

		let type = 'text';
		if (channel.type === ChannelType.GuildCategory) {
			type = 'category';
		} else if (channel.isVoiceBased()) {
			if (divisionMemberPerms && !memberPerms.has(PermissionsBitField.Flags.UseVAD)) {
				type = 'ptt';
			} else if (memberPerms && !memberPerms.has(PermissionsBitField.Flags.UseVAD)) {
				type = 'ptt';
			} else {
				type = 'voice';
			}
		}

		let perm = 'public';
		let divPerm = perm;
		if (everyonePerms.has(PermissionsBitField.Flags.ViewChannel)) {
			if (!everyonePerms.has(PermissionsBitField.Flags.SendMessages)) {
				divPerm = perm = 'feed';
			}
		} else if (guestPerms && guestPerms.has(PermissionsBitField.Flags.ViewChannel)) {
			divPerm = perm = 'guest';
		} else if (memberPerms && memberPerms.has(PermissionsBitField.Flags.ViewChannel)) {
			divPerm = perm = 'member';
		} else if (divisionPerms && divisionPerms.has(PermissionsBitField.Flags.ViewChannel)) {
			if (!everyonePerms.has(PermissionsBitField.Flags.SendMessages)) {
				perm = 'role-feed';
				divPerm = 'feed';
			} else {
				perm = 'role';
				divPerm = 'public';
			}
		} else if (divisionMemberPerms && divisionMemberPerms.has(PermissionsBitField.Flags.ViewChannel)) {
			perm = 'role';
			divPerm = 'member';
		} else if (channelRolePerms && channelRolePerms.has(PermissionsBitField.Flags.ViewChannel)) {
			if (!everyonePerms.has(PermissionsBitField.Flags.SendMessages)) {
				divPerm = perm = 'role-feed';
			} else {
				divPerm = perm = 'role';
			}
		} else if (officerPerms && officerPerms.has(PermissionsBitField.Flags.ViewChannel)) {
			divPerm = perm = 'officer';
		} else if (modPerms.has(PermissionsBitField.Flags.ViewChannel)) {
			divPerm = perm = 'mod';
		} else if (staffPerms.has(PermissionsBitField.Flags.ViewChannel)) {
			divPerm = perm = 'staff';
		} else {
			divPerm = perm = 'admin';
		}

		let details = {};
		details.everyone = getPermissionDetails(everyonePerms);
		if (guestPerms) {
			details.guest = getPermissionDetails(guestPerms);
			details.guest.role = guestRole;
		}
		if (memberPerms) {
			details.member = getPermissionDetails(memberPerms);
			details.member.role = memberRole;
		}
		if (divisionRole && divisionPerms) {
			details.division = getPermissionDetails(divisionPerms);
			details.division.role = divisionRole;
		}
		if (divisionMemberRole && divisionMemberPerms) {
			details.divisionMember = getPermissionDetails(divisionMemberPerms);
			details.divisionMember.role = divisionMemberRole;
		}
		if (channelRole && channelRolePerms) {
			details.role = getPermissionDetails(channelRolePerms);
			details.role.role = channelRole;
		}
		if (officerRole && officerPerms) {
			details.officer = getPermissionDetails(officerPerms);
			details.officer.role = officerRole;
		}
		details.mod = getPermissionDetails(modPerms);
		details.staff = getPermissionDetails(staffPerms);

		resolve({
			id: channel.id,
			type: type,
			perm: perm,
			divPerm: divPerm,
			details: details
		});
	});
	return promise;
}
global.getChannelInfo = getChannelInfo;

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

async function setChannelPerms(guild, message, member, perm, channel, type, level, category, officerRole, role, targetMember) {
	//get channel permissions
	if (channel.isVoiceBased()) {
		if (type !== 'voice' && type !== 'ptt') {
			const memberRole = guild.roles.cache.find(r => { return r.name == config.memberRole; });
			const memberPerms = await channel.permissionsFor(memberRole);
			if (memberPerms && !memberPerms.has(PermissionsBitField.Flags.UseVAD)) {
				type = 'ptt';
			} else {
				type = 'voice';
			}
		}
	} else {
		type = 'text';
	}
	var permissions = await getChannelPermissions(guild, message, perm, level, type, officerRole, role, targetMember);
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
				console.log(error);
				reject();
			});
	});
	return promise;
}
global.setChannelPerms = setChannelPerms;

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

function getDivisionsFromTracker() {
	let promise = new Promise(async function(resolve, reject) {
		let now = new Date();
		if (_divisions && ((now - _lastDivisionsRefresh) < (60 * 1000))) {
			//only refresh once per minute
			resolve(_divisions);
		}
		try {
			let response = await fetchTimeout(`${config.trackerAPIURL}/divisions?include-shutdown`, 1000, {
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
					if (division.leadership) {
						_divisions[division.name].leadership = division.leadership;
					}
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

function updateTrackerDivisionData(divisionData, data) {
	let promise = new Promise(async function(resolve, reject) {
		if (config.devMode === true) {
			resolve();
			return;
		}
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

function updateOnboarding(guild, message) {
	let promise = new Promise(async function(resolve, reject) {
		let onboarding = await guild.fetchOnboarding().catch(console.log);
		let prompts = [];
		let existingPrompt;
		if (onboarding) {
			for (let [id, p] of onboarding.prompts) {
				if (p.title == config.onboardingTitle) {
					existingPrompt = p;
				} else {
					//prompts.push(p.toJSON()); //FUCK YOU discord.js
					//discord.js does not serialize the prompt options in to the proper format
				}
			}
		}

		let newPrompt = {
			guildId: guild.id,
			inOnboarding: true,
			required: false,
			singleSelect: false,
			title: config.onboardingTitle,
			type: GuildOnboardingPromptType.MultipleChoice,
			options: []
		};
		if (existingPrompt) {
			newPrompt.id = existingPrompt.id;
		}
		await guild.emojis.fetch();
		let divisions = await getDivisionsFromTracker();
		for (const divisionName in divisions) {
			if (divisions.hasOwnProperty(divisionName)) {
				const division = divisions[divisionName];
				const lcName = divisionName.toLowerCase();
				let divisionCategory = guild.channels.cache.find(c => (c.type == ChannelType.GuildCategory && c.name.toLowerCase() == lcName));
				let divisionRole = guild.roles.cache.find(r => r.name == divisionName);
				if (divisionCategory && divisionRole) {
					let emoji = guild.emojis.cache.find(e => e.name == division.abbreviation);
					let opt = {
						title: divisionName,
						channels: divisionCategory.children.cache.map(c => c.id),
						roles: [divisionRole.id],
						emoji: (emoji ? `<:${emoji.identifier}>` : '')
					};
					opt.channels.push(divisionCategory.id);
					if (existingPrompt) {
						let existingOption = existingPrompt.options.find(p => p.title == divisionName);
						if (existingOption) {
							opt.id = existingOption.id;
						}
					}
					newPrompt.options.push(opt);
				}
			}
		}
		prompts.push(newPrompt);

		await guild.editOnboarding({ prompts: prompts }).catch(console.log);
		if (message) {
			await ephemeralReply(message, "Updated onboarding options");
		}
		resolve();
	});
	return promise;
}
global.updateOnboarding = updateOnboarding;

async function addDivision(message, member, perm, guild, divisionName) {
	let officerRoleName = divisionName + ' ' + config.discordOfficerSuffix;
	let memberRoleName = divisionName + ' ' + config.discordMemberSuffix;
	let divisionRoleName = divisionName;
	let lcName = divisionName.toLowerCase();
	let simpleName = lcName.replace(/\s/g, '-');

	let divisionCategory = guild.channels.cache.find(c => (c.type == ChannelType.GuildCategory && c.name.toLowerCase() == lcName));
	if (divisionCategory)
		return ephemeralReply(message, "Division category already exists.");
	let divisionOfficerRole = guild.roles.cache.find(r => { return r.name == officerRoleName; });
	if (divisionOfficerRole)
		return ephemeralReply(message, "Division officer role already exists.");
	let divisionMemberRole = guild.roles.cache.find(r => { return r.name == memberRoleName; });
	if (divisionMemberRole)
		return ephemeralReply(message, "Division member role already exists.");
	let divisionRole = guild.roles.cache.find(r => { return r.name == divisionRoleName; });
	if (divisionRole)
		return ephemeralReply(message, "Division role already exists.");

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
		const memberRole = guild.roles.cache.find(r => { return r.name == config.memberRole; });
		const guestRole = guild.roles.cache.find(r => { return r.name == config.guestRole; });

		//create roles
		divisionOfficerRole = await guild.roles.create({
			name: officerRoleName,
			permissions: [],
			mentionable: true,
			reason: `Requested by ${getNameFromMessage(message)}`
		});
		await divisionOfficerRole.setPosition(memberRole.position + 1).catch(console.log);
		divisionMemberRole = await guild.roles.create({
			name: memberRoleName,
			permissions: [],
			mentionable: false,
			reason: `Requested by ${getNameFromMessage(message)}`
		});
		await divisionMemberRole.setPosition(memberRole.position - 1).catch(console.log);
		divisionRole = await guild.roles.create({
			name: divisionRoleName,
			permissions: [],
			mentionable: false,
			reason: `Requested by ${getNameFromMessage(message)}`
		});
		await divisionRole.setPosition(guestRole.position + 1).catch(console.log);

		await setDependentRole(guild, message, divisionMemberRole, memberRole, false);
		await setDependentRole(guild, message, divisionMemberRole, divisionRole, false);
		await addManagedRole(message, member, guild, divisionRoleName, false, false);
		await addManagedRole(message, member, guild, divisionRoleName, false, true);

		//add category for division
		let permissions = await getChannelPermissions(guild, message, perm,
			'role', 'text', divisionOfficerRole, divisionRole);
		divisionCategory = await guild.channels.create({
			type: ChannelType.GuildCategory,
			name: divisionName,
			permissionOverwrites: permissions,
			reason: `Requested by ${getNameFromMessage(message)}`
		}).catch(console.log);
		if (!divisionCategory) {
			return ephemeralReply(`Failed to create division category. Aborting division create.`);
		}

		//create members channel
		permissions = await getChannelPermissions(guild, message, perm,
			'role', 'text', divisionOfficerRole, divisionMemberRole);
		let membersChannel = await guild.channels.create({
			type: ChannelType.GuildText,
			name: divisionMembersChannel,
			parent: divisionCategory,
			permissionOverwrites: permissions,
			reason: `Requested by ${getNameFromMessage(message)}`
		}).catch(console.log);
		if (!membersChannel) {
			await ephemeralReply(`Failed to create members channel`);
		}

		//create officers channel
		permissions = await getChannelPermissions(guild, message, perm,
			'officer', 'text', divisionOfficerRole);
		let officersChannel = await guild.channels.create({
			type: ChannelType.GuildText,
			name: divisionOfficersChannel,
			parent: divisionCategory,
			permissionOverwrites: permissions,
			reason: `Requested by ${getNameFromMessage(message)}`
		}).catch(console.log);
		if (!officersChannel) {
			await ephemeralReply(`Failed to create officers channel`);
		}

		//create public channel
		permissions = await getChannelPermissions(guild, message, perm,
			'role', 'text', divisionOfficerRole, divisionRole);
		let publicChannel = await guild.channels.create({
			type: ChannelType.GuildText,
			name: divisionPublicChannel,
			parent: divisionCategory,
			permissionOverwrites: permissions,
			reason: `Requested by ${getNameFromMessage(message)}`
		}).catch(console.log);
		if (!publicChannel) {
			await ephemeralReply(`Failed to create public channel`);
		}

		//create member voice channel
		permissions = await getChannelPermissions(guild, message, perm,
			'role', 'voice', divisionOfficerRole, divisionMemberRole);
		let memberVoipChannel = await guild.channels.create({
			type: ChannelType.GuildVoice,
			name: divisionMemberVoiceChannel,
			parent: divisionCategory,
			permissionOverwrites: permissions,
			reason: `Requested by ${getNameFromMessage(message)}`
		}).catch(console.log);
		if (!memberVoipChannel) {
			await ephemeralReply(`Failed to create member voip channel`);
		}

		addForumSyncMap(message, guild, officerRoleName, divisionName + ' ' + config.forumOfficerSuffix);
		if (config.officerRole) {
			addForumSyncMap(message, guild, config.officerRole, divisionName + ' ' + config.forumOfficerSuffix);
		}
		if (divisionData && officersChannel) {
			await updateTrackerDivisionOfficerChannel(divisionData, officersChannel);
		}

		if (divisionData && divisionData.icon) {
			await guild.emojis.fetch();
			let emoji = guild.emojis.cache.find(e => e.name == divisionData.abbreviation);
			if (!emoji) {
				await guild.emojis.create({ attachment: divisionData.icon, name: divisionData.abbreviation })
					.catch(console.log);
			}
		}

		await updateOnboarding(guild, message);

		return ephemeralReply(message, `${divisionName} division added`);
	} catch (error) {
		console.log(error);
		return ephemeralReply(message, `Failed to add ${divisionName} division`);
	}
}
global.addDivision = addDivision;

async function deleteDivision(message, member, perm, guild, divisionName) {
	let officerRoleName = divisionName + ' ' + config.discordOfficerSuffix;
	let memberRoleName = divisionName + ' ' + config.discordMemberSuffix;
	let divisionRoleName = divisionName;

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
				await ephemeralReply(message, `Failed to delete channel ${c.name}`);
				console.log(error);
			}
		}

		//remove category
		try {
			await divisionCategory.delete(`Requested by ${getNameFromMessage(message)}`);
			await ephemeralReply(message, `${divisionName} category removed`);
		} catch (error) {
			await ephemeralReply(message, `Failed to delete category ${divisionName}`);
			console.log(error);
		}
	} else {
		await ephemeralReply(message, `${divisionName} category not found`);
	}

	let offcerRole = guild.roles.cache.find(r => { return r.name == officerRoleName; });
	let memberRole = guild.roles.cache.find(r => { return r.name == memberRoleName; });
	let divisionRole = guild.roles.cache.find(r => { return r.name == divisionRoleName; });

	await removeManagedRole(message, member, guild, divisionRoleName, true);
	await removeManagedRole(message, member, guild, divisionRoleName, false);
	await unsetDependentRole(guild, message, memberRole, memberRole);
	await unsetDependentRole(guild, message, memberRole, divisionRole);

	if (config.officerRole) {
		removeForumSyncMap(message, guild, config.officerRole, divisionName + ' ' + config.forumOfficerSuffix);
	}
	if (forumIntegrationConfig[officerRoleName] !== undefined) {
		delete(forumIntegrationConfig[officerRoleName]);
		fs.writeFileSync(config.forumGroupConfig, JSON.stringify(forumIntegrationConfig), 'utf8');
		getRolesByForumGroup(guild, true);
	}

	if (offcerRole) {
		try {
			await offcerRole.delete(`Requested by ${getNameFromMessage(message)}`);
			await ephemeralReply(message, `${officerRoleName} role removed`);
		} catch (error) {
			await ephemeralReply(message, `Failed to delete role ${officerRoleName}`);
			console.log(error);
		}
	} else {
		await ephemeralReply(message, `${officerRoleName} role not found`);
	}

	if (memberRole) {
		try {
			await memberRole.delete(`Requested by ${getNameFromMessage(message)}`);
			await ephemeralReply(message, `${memberRoleName} role removed`);
		} catch (error) {
			await ephemeralReply(message, `Failed to delete role ${memberRoleName}`);
			console.log(error);
		}
	} else {
		await ephemeralReply(message, `${memberRoleName} role not found`);
	}


	if (divisionRole) {
		try {
			await divisionRole.delete(`Requested by ${getNameFromMessage(message)}`);
			await ephemeralReply(message, `${divisionRoleName} role removed`);
		} catch (error) {
			await ephemeralReply(message, `Failed to delete role ${divisionRoleName}`);
			console.log(error);
		}
	} else {
		await ephemeralReply(message, `${divisionRoleName} role not found`);
	}

	if (divisionData) {
		await guild.emojis.fetch();
		let emoji = guild.emojis.cache.find(e => e.name == divisionData.abbreviation);
		if (emoji) {
			await emoji.delete().catch(console.log);
		}
	}

	await updateOnboarding(guild, message);
}
global.deleteDivision = deleteDivision;

function getPresence(member) {
	let presence = ':black_circle:';
	if (member.presence) {
		switch (member.presence.status) {
			case 'online':
				presence = ':green_circle:';
				break;
			case 'idle':
				presence = ':yellow_circle:';
				break;
			case 'dnd':
				presence = ':red_circle:';
				break;
		}
	}
	return presence;
}

function escapeNameCharacter(ch) {
	return ('\\' + ch);
}

function escapeNameForOutput(name) {
	return name.replace(/[*_]/g, escapeNameCharacter);
}

function escapeDisplayNameForOutput(member) {
	return escapeNameForOutput(member.displayName);
}

function getUsernameWithPresence(member) {
	return getPresence(member) + ' ' + escapeNameForOutput(member.user.username);
}
global.getUsernameWithPresence = getUsernameWithPresence;

function getDisplayNameWithPresence(member) {
	return getPresence(member) + ' ' + escapeNameForOutput(member.displayName);
}
global.getDisplayNameWithPresence = getDisplayNameWithPresence;

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
			role.members.sort((a, b) => a.displayName.localeCompare(b.displayName)).values(), "", getDisplayNameWithPresence);
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
function commandSub(message, member, cmd, args, guild, perm, isDM) {
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

async function doAddManagedRole(message, guild, rolesConfig, otherRolesConfig, roleName, role, isNew, commonString) {
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

async function doRemoveManagedRole(message, guild, rolesConfig, otherRolesConfig, roleName, commonString) {
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

async function doRenameManagedRole(message, guild, rolesConfig, otherRolesConfig, roleName, newRoleName) {
	if (rolesConfig[roleName] === undefined) {
		return ephemeralReply(message, `Role ${roleName} is not managed`);
	} else {
		if (rolesConfig[newRoleName] !== undefined || otherRolesConfig[newRoleName] ||
			guild.roles.cache.find(r => r.name === newRoleName)) {
			return ephemeralReply(message, `Role ${newRoleName} already exists`);
		}

		let role = guild.roles.resolve(rolesConfig[roleName].roleID);
		let renamed = true;
		await role.setName(newRoleName)
			.then(() => {
				rolesConfig[newRoleName] = rolesConfig[roleName];
				delete rolesConfig[roleName];
				if (otherRolesConfig[roleName] !== undefined) {
					otherRolesConfig[newRoleName] = otherRolesConfig[roleName];
					delete otherRolesConfig[roleName];
				}
				saveRolesConfigFile();
			})
			.catch(error => {
				console.log(error);
				ephemeralReply(message, `Failed to rename ${roleName}`);
			});
		return ephemeralReply(message, `Role ${roleName} renamed to ${newRoleName}`);
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
	return ephemeralReply(message, {
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

	let role = guild.roles.cache.find(r => r.name == roleName);
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

	return doAddManagedRole(message, guild, rolesConfig, null, roleName, role, create, commonString);
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

	return doRemoveManagedRole(message, guild, rolesConfig, otherRolesConfig, roleName, commonString);
}
global.removeManagedRole = removeManagedRole;

async function renameManagedRole(message, member, guild, roleName, newRoleName) {
	if (managedRoles.assignable[roleName] !== undefined) {
		rolesConfig = managedRoles.assignable;
		otherRolesConfig = managedRoles.subscribable;
	} else if (managedRoles.subscribable[roleName] !== undefined) {
		rolesConfig = managedRoles.subscribable;
		otherRolesConfig = managedRoles.assignable;
	} else {
		return ephemeralReply(message, `Role ${roleName} is not manageable`);
	}

	return doRenameManagedRole(message, guild, rolesConfig, otherRolesConfig, roleName, newRoleName);
}
global.renameManagedRole = renameManagedRole;

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

async function auditDependentRole(guild, message, dependentRole, requiredRole) {
	let toRemove = [];
	let toAdd = [];

	let dependentRoleId = '' + dependentRole.id;
	if (dependentRoles.requires[dependentRoleId] === undefined) {
		return ephemeralReply(message, `${dependentRole} is not a dependent role.`);
	}

	await ephemeralReply(message, `Auditing ${dependentRole}...`);
	if (requiredRole) {
		//Collection.difference returns elements from both sets; use filter instead
		toRemove = dependentRole.members.filter(m => { return !requiredRole.members.has(m); });
		//console.log(['req', dependentRole.name, requiredRole.name, toRemove.map(getMemberTag)]);
	} else {
		let sharedMembers;
		if (dependentRoles.requires[dependentRoleId] !== undefined) {
			let requiredRoleIds = dependentRoles.requires[dependentRoleId];
			for (let i = 0; i < requiredRoleIds.length; i++) {
				let requiredRole = guild.roles.resolve(requiredRoleIds[i]);
				if (requiredRole) {
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
			toRemove = dependentRole.members.filter(m => { return !sharedMembers.has(m.id); });
			toAdd = sharedMembers.filter(m => { return !dependentRole.members.has(m.id); });
		}
		//console.log(['noreq', dependentRole.name, sharedMembers.map(getMemberTag), toRemove.map(getMemberTag), toAdd.map(getMemberTag)]);
	}

	if (toRemove && toRemove.size) {
		let msg = '';
		for (const [id, m] of toRemove) {
			await m.roles.remove(dependentRole).catch(console.log);
			if (msg === '')
				msg = escapeDisplayNameForOutput(m);
			else
				msg += ',' + escapeDisplayNameForOutput(m);
		}
		msg = `Removed ${toRemove.size} members from ${dependentRole}: ` + msg;
		await ephemeralReply(message, truncateStr(msg, 2000));
	}
	if (toAdd && toAdd.size) {
		let msg = '';
		for (const [id, m] of toAdd) {
			await m.roles.add(dependentRole).catch(console.log);
			if (msg === '')
				msg = escapeDisplayNameForOutput(m);
			else
				msg += ',' + escapeDisplayNameForOutput(m);
		}
		msg = `Added ${toAdd.size} members to ${dependentRole}: ` + msg;
		await ephemeralReply(message, truncateStr(msg, 2000));
	}

	return ephemeralReply(message, `${dependentRole} audit complete.`);
}
global.auditDependentRole = auditDependentRole;

function auditDependentRoles(guild, message) {
	let promise = new Promise(async function(resolve, reject) {
		for (var dependentRoleId in dependentRoles.requires) {
			if (dependentRoles.requires.hasOwnProperty(dependentRoleId)) {
				let dependentRole = guild.roles.resolve(dependentRoleId);
				if (dependentRole) {
					await auditDependentRole(guild, message, dependentRole);
				}
			}
		}
		resolve();
	});
	return promise;
}
global.auditDependentRoles = auditDependentRoles;

function setDependentRole(guild, message, dependentRole, requiredRole, skipVerifyMembers) {
	let promise = new Promise(async function(resolve, reject) {
		let dependentRoleId = '' + dependentRole.id;
		let requiredRoleId = '' + requiredRole.id;
		let requiredRoleAdded = false;

		if (dependentRoles.requires[dependentRoleId] === undefined) {
			dependentRoles.requires[dependentRoleId] = [requiredRoleId];
			requiredRoleAdded = true;
		} else {
			if (!dependentRoles.requires[dependentRoleId].includes(requiredRoleId)) {
				dependentRoles.requires[dependentRoleId].push(requiredRoleId);
				requiredRoleAdded = true;
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

		if (requiredRoleAdded && !skipVerifyMembers) {
			auditDependentRole(guild, message, dependentRole, requiredRole);
		}

		if (message) {
			if (requiredRoleAdded)
				await ephemeralReply(message, `${requiredRole} added as required for ${dependentRole}`);
			else
				await ephemeralReply(message, `${requiredRole} already required for ${dependentRole}`);
		}

		resolve();
	});
	return promise;
}
global.setDependentRole = setDependentRole;

function unsetDependentRole(guild, message, dependentRole, requiredRole) {
	let promise = new Promise(async function(resolve, reject) {
		let dependentRoleId = '' + dependentRole.id;
		let requiredRoleId = '' + requiredRole.id;
		let requiredRoleRemoved = false;

		if (dependentRoles.requires[dependentRoleId] !== undefined) {
			let index = dependentRoles.requires[dependentRoleId].indexOf(requiredRoleId);
			if (index >= 0) {
				dependentRoles.requires[dependentRoleId].splice(index, 1);
				requiredRoleRemoved = true;
			}
			if (dependentRoles.requires[dependentRoleId].length == 0) {
				delete dependentRoles.requires[dependentRoleId];
			}
		}

		if (dependentRoles.requiredFor[requiredRoleId] !== undefined) {
			let index = dependentRoles.requiredFor[requiredRoleId].includes(dependentRoleId);
			if (index >= 0) {
				dependentRoles.requiredFor[requiredRoleId].splice(index, 1);
			}
			if (dependentRoles.requiredFor[requiredRoleId].length == 0) {
				delete dependentRoles.requiredFor[requiredRoleId];
			}
		}

		fs.writeFileSync(config.dependentRoles, JSON.stringify(dependentRoles), 'utf8');

		if (message) {
			if (requiredRoleRemoved)
				await ephemeralReply(message, `${requiredRole} removed as required for ${dependentRole}`);
			else
				await ephemeralReply(message, `${requiredRole} not required for ${dependentRole}`);
		}

		resolve();
	});
	return promise;
}
global.unsetDependentRole = unsetDependentRole;

function pruneDependentRoles(guild, message) {
	let promise = new Promise(async function(resolve, reject) {
		let doWrite = false;
		for (var dependentRoleId in dependentRoles.requires) {
			if (dependentRoles.requires.hasOwnProperty(dependentRoleId)) {
				let dependentRole = guild.roles.resolve(dependentRoleId);
				if (!dependentRole) {
					console.log(`Role dependency prune: Removing dependent role ${dependentRoleId}: no longer exists`);
					doWrite = true;
					let requiredRoleIds = dependentRoles.requires[dependentRoleId];
					for (let i = 0; i < requiredRoleIds.length; i++) {
						let requiredRoleId = requiredRoleIds[i];
						if (dependentRoles.requiredFor[requiredRoleId] !== undefined) {
							console.log(`Role dependency prune: Removing dependent role ${dependentRoleId} from ${requiredRoleId}`);
							let index = dependentRoles.requiredFor[requiredRoleId].indexOf(dependentRoleId);
							if (index >= 0) {
								dependentRoles.requiredFor[requiredRoleId].splice(index, 1);
							}
							if (dependentRoles.requiredFor[requiredRoleId].length == 0) {
								delete dependentRoles.requiredFor[requiredRoleId];
							}
						}
					}
					delete dependentRoles.requires[dependentRoleId];
				}
			}
		}
		for (var requiredRoleId in dependentRoles.requiredFor) {
			if (dependentRoles.requiredFor.hasOwnProperty(requiredRoleId)) {
				let requiredRole = guild.roles.resolve(requiredRoleId);
				if (!requiredRole) {
					console.log(`Role dependency prune: Removing required role ${requiredRoleId}: no longer exists`);
					doWrite = true;
					let dependentRoleIds = dependentRoles.requiredFor[requiredRoleId];
					for (let i = 0; i < dependentRoleIds.length; i++) {
						let dependentRoleId = dependentRoleIds[i];
						if (dependentRoles.requires[dependentRoleId] !== undefined) {
							console.log(`Role dependency prune: Removing required role ${requiredRoleId} for ${dependentRoleId}`);
							let index = dependentRoles.requires[dependentRoleId].indexOf(requiredRoleId);
							if (index >= 0) {
								dependentRoles.requires[dependentRoleId].splice(index, 1);
							}
							if (dependentRoles.requires[dependentRoleId].length == 0) {
								delete dependentRoles.requires[dependentRoleId];
							}
						}
					}
					delete dependentRoles.requiredFor[requiredRoleId];
				}
			}
		}
		if (doWrite) {
			fs.writeFileSync(config.dependentRoles, JSON.stringify(dependentRoles), 'utf8');
		}
		resolve();
	});
	return promise;
}
global.pruneDependentRoles = pruneDependentRoles;

function getDependentRoles(guild, message) {
	let roles = [];
	for (var dependentRoleId in dependentRoles.requires) {
		if (dependentRoles.requires.hasOwnProperty(dependentRoleId)) {
			let dependentRole = guild.roles.resolve(dependentRoleId);
			if (dependentRole) {
				roles.push(dependentRole);
			}
		}
	}
	return roles;
}
global.getDependentRoles = getDependentRoles;

function getRequiredRoles(guild, message, dependentRole) {
	let roles = [];
	let requiredRoles = dependentRoles.requires[dependentRole.id] ?? [];
	for (let i = 0; i < requiredRoles.length; i++) {
		let requiredRoleId = requiredRoles[i];
		let requiredRole = guild.roles.resolve(requiredRoleId);
		if (requiredRole)
			roles.push(requiredRole);
	}
	return roles;
}
global.getRequiredRoles = getRequiredRoles;

function listDependentRoles(guild, message) {
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
	return ephemeralReply(message, { embeds: [embed] });
}
global.listDependentRoles = listDependentRoles;

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

function commandShowWebhooks(message, member, cmd, args, guild, perm, isDM)
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
		.catch(console.log);
}*/

//get forum groups from forum database
function getForumGroups() {
	var promise = new Promise(function(resolve, reject) {
		let db = connectToDB();
		let query = `SELECT usergroupid AS id,title AS name FROM ${config.mysql.prefix}usergroup ` +
			`WHERE title LIKE "AOD%" OR title LIKE "%Officers" ` +
			`OR title LIKE "Division CO" OR title LIKE "Division XO" ` +
			`OR title LIKE "Registered Users"`;
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
global.getForumGroups = getForumGroups;

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

const rankAbbr = {
	"Forum Member": "",
	"Prospective Member": "",
	"Recruit": "[Rct] ",
	"Cadet": "[Cdt] ",
	"Private": "[Pvt] ",
	"Private First Class": "[Pfc] ",
	"Specialist": "[Spec] ",
	"Trainer": "[Tr] ",
	"Lance Corporal": "[LCpl] ",
	"Corporal": "[Cpl] ",
	"Sergeant": "[Sgt] ",
	"Staff Sergeant": "[SSgt] ",
	"Master Sergeant": "[MSgt] ",
	"First Sergeant": "[1stSgt] ",
	"Command Sergeant": "[CmdSgt] ",
	"Sergeant Major": "[SgtMaj] "
};

function getRankAbbr(rank) {
	return rankAbbr[rank] ?? '';
}

function getDiscordNickname(name, rank) {
	if (name.startsWith('AOD_SgtMaj_'))
		return name.replace('AOD_SgtMaj_', getRankAbbr(rank));
	if (name.startsWith('AOD_'))
		return name.replace('AOD_', getRankAbbr(rank));
	return getRankAbbr(rank) + name;
}

function getForumUsersForGroups(groups, allowPending) {
	var promise = new Promise(function(resolve, reject) {
		let usersByIDOrDiscriminator = {};
		let db = connectToDB();
		let groupStr = groups.join(',');
		let groupRegex = groups.join('|');
		let query =
			`SELECT u.userid,u.username,` +
			`  IF(f.field19 NOT LIKE "%#%" OR f.field19 LIKE "%#0", LOWER(f.field19), f.field19) AS field19,` +
			`  f.field20,f.field11,f.field13,f.field23,f.field24,` +
			`  (CASE WHEN (r.requester_id IS NOT NULL) THEN 1 ELSE 0 END) AS pending, t.name AS pending_name ` +
			`FROM ${config.mysql.prefix}user AS u ` +
			`INNER JOIN ${config.mysql.prefix}userfield AS f ON u.userid=f.userid ` +
			`LEFT JOIN ${config.mysql.trackerPrefix}member_requests AS r ON u.userid=r.member_id AND r.approver_id IS NULL ` +
			`  AND r.cancelled_at IS NULL AND r.hold_placed_at IS NULL AND r.created_at > (NOW() - INTERVAL 24 HOUR) ` +
			`LEFT JOIN ${config.mysql.trackerPrefix}members AS t on u.userid=t.clan_id ` +
			`WHERE ((u.usergroupid IN (${groupStr}) OR u.membergroupids REGEXP '(^|,)(${groupRegex})(,|$)') `;
		if (allowPending === true) {
			query +=
				`OR r.requester_id IS NOT NULL `;
		} else {
			query +=
				`AND r.requester_id IS NULL `;
		}
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
						pendingName: row.pending_name,
						id: row.userid,
						division: row.field13,
						rank: row.field11,
						rankAbbr: getRankAbbr(row.field11),
						discordNickname: getDiscordNickname(row.pending ? row.pending_name : row.username, row.field11),
						discordid: discordid,
						discordtag: discordtag,
						discordstatus: row.field24,
						discordactivity: row.field23,
						pending: row.pending,
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
			`SELECT u.userid,u.username,f.field13,f.field11,f.field14,f.field19,f.field20,g.title ` +
			`FROM ${config.mysql.prefix}user AS u ` +
			`INNER JOIN ${config.mysql.prefix}userfield AS f ON u.userid=f.userid ` +
			`INNER JOIN ${config.mysql.prefix}usergroup AS g ON u.usergroupid=g.usergroupid `;
		if (typeof(member) === 'object') {
			query += `WHERE f.field20 LIKE "${member.id}" `;
		} else if (!isNaN(parseInt(member))) {
			query += `WHERE u.userid=${member} `;
		} else {
			let username = db.escape(member);
			query += `WHERE u.username LIKE ${username} `;
		}
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
					forumGroup: row.title,
					discordtag: row.field19,
					discordid: row.field20
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
	if (config.devMode !== true) {
		console.log(`Updating Discord ID for ${forumUser.name} (${forumUser.id}) Discord Tag ${guildMember.user.tag} from '${forumUser.discordid}' to '${guildMember.user.id}'`);
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
	if (config.devMode !== true) {
		console.log(`Updating Discord Tag for ${forumUser.name} (${forumUser.id}) Discord ID ${guildMember.user.id} from '${forumUser.discordtag}' to '${guildMember.user.tag}'`);
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
	if (config.devMode !== true) {
		console.log(`Updating Discord Status for ${forumUser.name} (${forumUser.id}) from '${forumUser.discordstatus}' to '${status}'`);
		let db = connectToDB();
		let query = `UPDATE ${config.mysql.prefix}userfield SET field24='${status}' WHERE userid=${forumUser.id}`;
		db.query(query, function(err, rows, fields) {});
	}
	forumUser.discordstatus = status;
}

const activityInterval_s = 15 * 60; //15 minutes
function setDiscordActivityForForumUser(forumUser, activityEpochMs) {
	activityEpoch = '' + (Math.floor((activityEpochMs / 1000) / activityInterval_s) * activityInterval_s);
	if (forumUser.discordactivity === activityEpoch)
		return;
	//console.log(`Updating Discord Activity for ${forumUser.name} (${forumUser.id}) from '${forumUser.discordactivity}' to '${activityEpoch}'`);
	if (config.devMode !== true) {
		let db = connectToDB();
		let query = `UPDATE ${config.mysql.prefix}userfield SET field23='${activityEpoch}' WHERE userid=${forumUser.id}`;
		db.query(query, function(err, rows, fields) {});
	}
	forumUser.discordactivity = activityEpoch;
}

function clearDiscordDataForForumUser(forumUser) {
	if (config.devMode !== true) {
		console.log(`Clearing Discord data for ${forumUser.name} (${forumUser.id})`);
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
function doForumSync(message, member, guild, perm, doDaily) {
	let promise = new Promise(async function(resolve, reject) {
		var hrStart = process.hrtime();
		await guild.roles.fetch()
			.catch(error => { console.log(error); });
		const guestRole = guild.roles.cache.find(r => { return r.name == config.guestRole; });
		const memberRole = guild.roles.cache.find(r => { return r.name == config.memberRole; });
		const notificationChannel = guild.channels.cache.find(c => { return c.name === config.globalNotificationChannel; });
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
		} catch (e) {
			console.error(e);
			resolve();
		}

		let date = new Date();
		try {
			if (config.devMode !== true) {
				fs.writeFileSync(config.syncLogFile, `${date.toISOString()}  Forum sync started\n`, 'utf8');
			}
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
			if (config.devMode !== true) {
				fs.writeFileSync(config.populationLogFile, `${online}/${idle}/${dnd}/${total}\n`, 'utf8');
			}
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
				if (groupMap.roleID === undefined || groupMap.roleID === '') {
					//make sure we actually have the roleID in our structure
					role = guild.roles.cache.find(matchGuildRoleName, roleName);
					if (role)
						groupMap.roleID = role.id;
				} else {
					role = guild.roles.resolve(groupMap.roleID);
				}

				if (role) {
					let isMemberRole = (role.id === memberRole.id);
					let isGuestRole = (role.id === guestRole.id);
					let usersByIDOrDiscriminator;
					try {
						usersByIDOrDiscriminator = await getForumUsersForGroups(groupMap.forumGroups, isMemberRole);
					} catch (error) {
						console.log(error);
						continue;
					}

					date = new Date();
					let epochMs = date.getTime();
					if (config.devMode !== true) {
						fs.appendFileSync(config.syncLogFile, `${date.toISOString()}  Sync ${role.name}\n`, 'utf8');
					}
					let embed = {
						title: `Sync ${role.name}`,
						fields: []
					};

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
							if (!isGuestRole) {
								removes++;
								toRemove.push(`${roleMember.user.tag} (${roleMember.displayName})`);
								try {
									await roleMember.roles.remove(role, reason);
									if (isMemberRole) {
										//we're removing them from AOD, clear the name set from the forums
										await roleMember.setNickname('', reason);
										//Members shouldn't have been guests... lest there be a strange permission thing when AOD members are removed
										if (roleMember.roles.cache.get(guestRole.id))
											await roleMember.roles.remove(guestRole);
									}
								} catch (error) {
									console.error(`Failed to remove ${role.name} from ${roleMember.user.tag}`);
								}
							}
						} else {
							if (isMemberRole || isGuestRole) {
								if (roleMember.manageable) {
									if (nickNameChanges[roleMember.user.id] === undefined && roleMember.displayName !== forumUser.discordNickname) {
										nickNameChanges[roleMember.user.id] = true;
										if (!isGuestRole) {
											renames++;
											toUpdate.push(`${roleMember.user.tag} (${roleMember.displayName} ==> ${forumUser.discordNickname})`);
										}
										try {
											await roleMember.setNickname(forumUser.discordNickname, reason);
										} catch (error) {
											console.error(`Failed to set nickname for ${roleMember.user.tag}`);
										}
									}
								}
								setDiscordTagForForumUser(forumUser, roleMember);
								setDiscordStatusForForumUser(forumUser, 'connected');
							}

							if (isMemberRole) {
								if (roleMember.voice.channel)
									setDiscordActivityForForumUser(forumUser, epochMs);
								else if (localVoiceStatusUpdates[roleMember.id])
									setDiscordActivityForForumUser(forumUser, localVoiceStatusUpdates[roleMember.id]);

								//Members shouldn't also be guests... lest there be a strange permission thing when AOD members are removed
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
										console.error(`Failed to remove ${guestRole.name} from ${roleMember.user.tag}`);
									}
								}
							} else if (isGuestRole) {
								if (seenByID[roleMember.id] !== undefined) {
									duplicateTag.push(`${roleMember.user.tag} (${forumUser.name}) -- First seen user ${seenByID[roleMember.id].name}`);
									duplicates++;
								} else {
									seenByID[roleMember.id] = forumUser;
								}
							}
						}
					}

					//for each forum member mapped to the role
					//   if we haven't already seen the guild member
					//       if there is a guild member record, add them to the role and make sure the nickname is valid
					//       otherwise, mark them as an error and move on
					let toAdd = [];
					let noAccount = [];
					let leftServer = [];
					for (let u in usersByIDOrDiscriminator) {
						if (usersByIDOrDiscriminator.hasOwnProperty(u)) {
							if (membersByID[u] === undefined) {
								let forumUser = usersByIDOrDiscriminator[u];

								let guildMember = guild.members.resolve(u);
								if ((guildMember === undefined || guildMember === null) && !forumUser.indexIsId) {
									guildMember = guild.members.cache.find(matchGuildMemberTag, u);
									if (guildMember) {
										//don't update the list, we're done processing
										setDiscordIDForForumUser(forumUser, guildMember);
									}
								}
								if (guildMember) {
									if (!isGuestRole) {
										adds++;
										toAdd.push(`${guildMember.user.tag} (${forumUser.name})`);
									}
									try {
										await guildMember.roles.add(role, reason);
									} catch (error) {
										console.error(`Failed to add ${role.name} to ${guildMember.user.tag}`);
									}
									if (nickNameChanges[guildMember.user.id] === undefined && guildMember.displayName !== forumUser.name) {
										nickNameChanges[guildMember.user.id] = true;
										if (!isGuestRole) {
											renames++;
											toUpdate.push(`${guildMember.user.tag} (${guildMember.displayName} ==> ${forumUser.name})`);
										}
										try {
											await guildMember.setNickname(forumUser.name, reason);
										} catch (error) {
											console.error(`Failed to rename ${guildMember.user.tag} to ${forumUser.name}`);
										}
									}
									setDiscordTagForForumUser(forumUser, guildMember);
									if (isMemberRole) {
										setDiscordStatusForForumUser(forumUser, 'connected');
										if (guildMember.voice.channel)
											setDiscordActivityForForumUser(forumUser, epochMs);
										else if (localVoiceStatusUpdates[guildMember.id])
											setDiscordActivityForForumUser(forumUser, localVoiceStatusUpdates[guildMember.id]);
									}
								} else {
									if (isMemberRole) {
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
									} else if (isGuestRole) {
										//We don't need to constantly reprocess old AOD members who have left or forum guests who visited discord once
										clearDiscordDataForForumUser(forumUser);
									}
								}
							}
						}
					}

					if (!isGuestRole && config.devMode !== true) {
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
				} else {
					console.log(`${roleName} not found`);
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
						let officer_channel = guild.channels.resolve(divisionData.officer_channel);
						if (!officer_channel)
							officer_channel = guild.channels.cache.find(c => c.name === divisionData.officer_channel && c.type === ChannelType.GuildText) ?? notificationChannel;
						if (officer_channel) {
							officer_channel.send(`${divisionName} Division: ` +
								`The forum sync process found ${division_misses} members with no discord account and ` +
								`${division_disconnected} members who have left the server. ` +
								`Please check the [${divisionName} Voice Report](${config.trackerURL}/divisions/${divisionData.slug}/voice-report)`).catch(() => {});
						}
					}
				}
			}
		}
		if (duplicates > 0) {
			if (notificationChannel) {
				notificationChannel.send(`The forum sync process found ${duplicates} duplicate tags. Please check https://www.clanaod.net/forums/aodinfo.php?type=last_discord_sync for the last sync status.`).catch(() => {});
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
		if (config.devMode !== true) {
			fs.appendFileSync(config.syncLogFile, `${date.toISOString()}  ${msg}\n`, 'utf8');
		}
		resolve();
	});
	return promise;
}
global.doForumSync = doForumSync;


function addForumSyncMap(message, guild, roleName, groupName) {
	let promise = new Promise(async function(resolve, reject) {
		const role = guild.roles.cache.find(r => { return r.name == roleName; });
		if (!role) {
			await ephemeralReply(message, `${roleName} role not found`);
			resolve();
			return;
		}
		let map = forumIntegrationConfig[role.name];
		if (map && map.permanent) {
			await ephemeralReply(message, `${roleName} can not be edited`);
			resolve();
			return;
		}

		let forumGroups = await getForumGroups()
			.catch(console.log);
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
				getRolesByForumGroup(guild, true); //update cache
				await ephemeralReply(message, `Mapped group ${groupName} to role ${role.name}`);
			} else {
				let index = map.forumGroups.indexOf(forumGroupId);
				if (index < 0) {
					map.forumGroups.push(forumGroupId);
					fs.writeFileSync(config.forumGroupConfig, JSON.stringify(forumIntegrationConfig), 'utf8');
					getRolesByForumGroup(guild, true);
					await ephemeralReply(message, `Mapped group ${groupName} to role ${role.name}`);
				} else {
					await ephemeralReply(message, 'Map already exists');
				}
			}
		} else {
			await ephemeralReply(message, `${groupName} forum group not found`);
		}
		resolve();
	});
	return promise;
}
global.addForumSyncMap = addForumSyncMap;

function removeForumSyncMap(message, guild, roleName, groupName) {
	let promise = new Promise(async function(resolve, reject) {
		const role = guild.roles.cache.find(r => { return r.name == roleName; });
		if (!role) {
			await ephemeralReply(message, `${roleName} role not found`);
			resolve();
			return;
		}
		let map = forumIntegrationConfig[role.name];
		if (!map) {
			await ephemeralReply(message, 'Map does not exist');
			resolve();
			return;
		}
		if (map.permanent) {
			await ephemeralReply(message, `${roleName} can not be edited`);
			resolve();
			return;
		}

		let forumGroups = await getForumGroups()
			.catch(console.log);
		let forumGroupId = parseInt(Object.keys(forumGroups).find(k => {
			if (forumGroups[k] !== groupName)
				return false;
			return true;
		}), 10);

		let index = map.forumGroups.indexOf(forumGroupId);
		if (index < 0) {
			await ephemeralReply(message, 'Map does not exist');
		} else {
			map.forumGroups.splice(index, 1);
			if (map.forumGroups.length === 0)
				delete forumIntegrationConfig[role.name];
			fs.writeFileSync(config.forumGroupConfig, JSON.stringify(forumIntegrationConfig), 'utf8');
			getRolesByForumGroup(guild, true); //update cache
			await ephemeralReply(message, `Removed map of group ${groupName} to role ${role.name}`);
		}
		resolve();
	});
	return promise;
}
global.removeForumSyncMap = removeForumSyncMap;

function pruneForumSyncMap(message, guild) {
	let promise = new Promise(async function(resolve, reject) {
		let doWrite = false;
		let reply = "";
		Object.keys(forumIntegrationConfig).forEach(async (roleName) => {
			const role = guild.roles.cache.find(r => { return r.name == roleName; });
			if (!role) {
				reply += `Remove map for deleted role ${roleName}\n`;
				delete forumIntegrationConfig[roleName];
				doWrite = true;
			} else {
				let groupMap = forumIntegrationConfig[roleName];
				let forumGroups = await getForumGroups().catch(console.log);
				let i = 0;
				while (i < groupMap.forumGroups.length) {
					let group = groupMap.forumGroups[i];
					if (forumGroups[group] === undefined) {
						groupMap.forumGroups.splice(i, 1);
						doWrite = true;
						continue;
					}
					i++;
				}
				if (groupMap.forumGroups.length === 0) {
					delete forumIntegrationConfig[roleName];
				}
			}
		});
		if (doWrite) {
			fs.writeFileSync(config.forumGroupConfig, JSON.stringify(forumIntegrationConfig), 'utf8');
			getRolesByForumGroup(guild, true); //update cache
		}
		reply += "Prune complete.";
		ephemeralReply(message, reply);
	});
	return promise;
}
global.pruneForumSyncMap = pruneForumSyncMap;

//admin command processing
function commandSetAdmin(message, member, cmd, args, guild, perm, isDM) {
	addRemoveRole(message, guild, cmd === 'addadmin', 'Admin', getMemberFromMessageOrArgs(guild, message, args), true);
}

function reloadConfig(message) {
	console.log(`Reload config requested by ${getNameFromMessage(message)}`);
	config = require('./aod-discord-bot.config.json');
	message.reply('Configuration reloaded');
}
global.reloadConfig = reloadConfig;

//reload command processing
function commandReload(message, member, cmd, args, guild, perm, isDM) {
	reloadConfig(message);
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

//quit command processing
function commandQuit(message, member, cmd, args, guild, perm, isDM) {
	console.log(`Bot quit requested by ${getNameFromMessage(message)}`);
	client.destroy();
	process.exit();
}

//reload slash command processing
function commandReloadCommands(message, member, cmd, args, guild, perm, isDM) {
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

function startAPIServer() {
	let promise = new Promise(async function(resolve, reject) {
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
			console.log("API Server started");
		} catch (error) {
			console.log(error);
		}
		resolve();
	});
	return promise;
}
global.startAPIServer = startAPIServer;

function commandReloadAPI(message, member, cmd, args, guild, perm, isDM) {
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

async function commandTest(message, member, cmd, args, guild, perm, isDM) {
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
		callback: function(message, cmd, args, guild, perm, isDM)
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
	purge: {
		minPermission: PERM_STAFF,
		args: "<num>",
		helpText: "Purges the last <num> messages from the channel the command was run in (1 <= num <= 100).",
		callback: commandPurge
	},
	/*showwebhooks: {
		minPermission: PERM_ADMIN,
		args: "",
		helpText: "Show current webhooks",
		callback: commandShowWebhooks
	},*/
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
function processCommand(message, member, cmd, arg_string, guild, perm, isDM) {
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
			return commandObj.callback(message, member, cmd, args, guild, perm, isDM);
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
	var guild, role, perm;
	var member = message.member;
	if (!member) {
		if (message.author.bot) {
			if (!message.webhookId || message.webhookId === '' || message.webhookId !== message.author.id)
				return; //ignore messages from bots that are not from authorized webhooks

			let webhookPerms = config.webHookPerms[message.webhookId];
			if (webhookPerms === undefined)
				return; //this bot is not allowed
			perm = webhookPerms;

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
			perm = getPermissionLevelForMember(guild, member);
		}
	} else {
		guild = member.guild;
		if (!guild)
			return; //must have guild
		perm = getPermissionLevelForMember(guild, member);
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
		return processCommand(message, member, command, arg_string, guild, perm, isDM);
	} catch (error) {
		console.log(error);
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
	options = command.logOptions === false ? '' : ' options:[' + options.join(', ') + ']';
	console.log(`${getNameFromMessage(interaction)} executed: cmd:${cmd}${options}`);
}

function getButtonIdString(command, subCommand, args) {
	if (!subCommand) subCommand = '';
	if (!args) args = [];
	return `::${command}::${subCommand}::` + args.join('::');
}
global.getButtonIdString = getButtonIdString;

function sortAndLimitOptions(options, len, search) {
	let count = 0;
	return options
		.sort()
		.filter(o => {
			if (count >= len) {
				return false;
			} else if (o.toLowerCase().includes(search)) {
				count++;
				return true;
			} else {
				return false;
			}
		})
		.map(o => ({ name: o, value: o }));
}
global.sortAndLimitOptions = sortAndLimitOptions;

//Slash Command Processing
function loadSlashCommands(guild) {
	let promise = new Promise(async function(resolve, reject) {
		try {
			if (client.commands) {
				delete client.commands;
			}
			if (client.menuMap) {
				delete client.menuMap;
			}
			client.commands = new Collection();
			client.menuMap = {};
			const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
			for (const file of commandFiles) {
				try {
					delete require.cache[require.resolve(`./commands/${file}`)];
				} catch (error) {}
				const command = require(`./commands/${file}`);
				client.commands.set(command.data.name, command);
				if (command.menuCommands) {
					command.menuCommands.forEach(m => {
						client.menuMap[m.name] = command.data.name;
					});
				}
			}

			if (guild)
				await guild.commands.fetch().catch(console.log);
			if (client.isReady())
				await client.application.commands.fetch().catch(console.log);

			console.log("Slash commands installed");
			resolve();
		} catch (error) {
			console.log(error);
			reject();
		}
	});
	return promise;
}
global.loadSlashCommands = loadSlashCommands;
loadSlashCommands();

client.on('interactionCreate', async interaction => {
	let command;
	let commandName;
	let interactionArgs;
	if (interaction.isButton() || interaction.isModalSubmit()) {
		if (!interaction.customId.startsWith('::')) {
			//generic buttons handled through collectors
			return;
		}
		interactionArgs = interaction.customId.split('::');
		if (interactionArgs.length < 3) {
			return;
		}
		interactionArgs.shift(); //first is empty
		commandName = interactionArgs.shift();
		command = client.commands.get(commandName);
	} else if (interaction.isContextMenuCommand()) {
		commandName = client.menuMap[interaction.commandName];
		command = client.commands.get(commandName);
	} else {
		commandName = interaction.commandName;
		command = client.commands.get(interaction.commandName);
	}
	if (!command) {
		console.error(`${commandName} not found`);
		return;
	}

	let guild;
	let member;
	if (!interaction.inGuild()) {
		guild = client.guilds.resolve(config.guildId);
		member = guild.members.resolve(interaction.user.id);
		if (!member) {
			interaction.reply("You are not a member of the AOD server.");
			return;
		}
	} else {
		guild = interaction.guild;
		member = interaction.member;
	}
	let perm = getPermissionLevelForMember(guild, member);

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
			await command.execute(interaction, guild, member, perm);
			if (!interaction.replied)
				ephemeralReply(interaction, "Done");
		} catch (error) {
			if (error)
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
			await command.autocomplete(interaction, guild, member, perm).catch(console.log);
			if (!interaction.responded)
				interaction.respond([]).catch(console.log);
		} catch (error) {
			if (error)
				console.error(error);
			if (!interaction.responded)
				interaction.respond([]);
		}
	} else if (interaction.isButton()) {
		if (command.button === undefined) {
			console.log(`No button callback defined for ${commandName}`);
			return;
		}
		console.log(`${getNameFromMessage(interaction)} executed: button:${interaction.customId}`);
		try {
			let subCommand = interactionArgs.shift();
			await command.button(interaction, guild, member, perm, subCommand, interactionArgs);
			if (!interaction.replied)
				ephemeralReply(interaction, "Done");
		} catch (error) {
			if (error)
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
			await command.menu(interaction, guild, member, perm);
			if (!interaction.replied)
				sendInteractionReply(interaction, { content: "Done", ephemeral: true });
		} catch (error) {
			if (error)
				console.error(error);
			try {
				ephemeralReply(interaction, 'There was an error while executing your command');
			} catch (error) {}
		}
	} else if (interaction.isModalSubmit()) {
		if (command.modal === undefined) {
			console.log(`No modal callback defined for ${commandName}`);
			return;
		}
		console.log(`${getNameFromMessage(interaction)} executed: modal:${interaction.customId}`);
		try {
			let subCommand = interactionArgs.shift();
			await command.modal(interaction, guild, member, perm, subCommand, interactionArgs);
			if (!interaction.replied)
				ephemeralReply(interaction, "Done");
		} catch (error) {
			if (error)
				console.error(error);
			try {
				ephemeralReply(interaction, 'There was an error processing this action.');
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

function getHelpButtons(guild, message) {
	const row = new ActionRowBuilder();
	const authlink = new ButtonBuilder()
		.setCustomId(getButtonIdString('authlink'))
		.setLabel('Get Auth Link')
		.setStyle(ButtonStyle.Primary);
	row.addComponents(authlink);
	return row;
}
global.getHelpButtons = getHelpButtons;

var voiceStatusUpdates = {};

function tempChannelCreatedBy(channelId) {
	if (joinToCreateChannels.tempChannels[channelId]) {
		return joinToCreateChannels.tempChannels[channelId];
	}
	return null;
}
global.tempChannelCreatedBy = tempChannelCreatedBy;


function getJTCButtons(channelInfo, member) {
	const permRow = new ActionRowBuilder();
	const set_public = new ButtonBuilder()
		.setCustomId(getButtonIdString('channel', 'set_jtc_public', [channelInfo.id]))
		.setLabel('Set Public')
		.setStyle(ButtonStyle.Primary)
		.setDisabled((channelInfo.perm == 'public' || channelInfo.divPerm == 'public'));
	permRow.addComponents(set_public);
	const set_member = new ButtonBuilder()
		.setCustomId(getButtonIdString('channel', 'set_jtc_member', [channelInfo.id]))
		.setLabel('Set Member')
		.setStyle(ButtonStyle.Primary)
		.setDisabled((channelInfo.perm == 'member' || channelInfo.divPerm == 'member'));
	permRow.addComponents(set_member);
	const set_officer = new ButtonBuilder()
		.setCustomId(getButtonIdString('channel', 'set_jtc_officer', [channelInfo.id]))
		.setLabel('Set Officer')
		.setStyle(ButtonStyle.Primary)
		.setDisabled(channelInfo.perm == 'officer');
	permRow.addComponents(set_officer);

	const typeRow = new ActionRowBuilder();
	const set_vad = new ButtonBuilder()
		.setCustomId(getButtonIdString('channel', 'set_jtc_vad', [channelInfo.id]))
		.setLabel('Set VAD')
		.setStyle(ButtonStyle.Primary)
		.setDisabled(channelInfo.type == 'voice');
	typeRow.addComponents(set_vad);
	const set_ptt = new ButtonBuilder()
		.setCustomId(getButtonIdString('channel', 'set_jtc_ptt', [channelInfo.id]))
		.setLabel('Set PTT')
		.setStyle(ButtonStyle.Primary)
		.setDisabled(channelInfo.type == 'ptt');
	typeRow.addComponents(set_ptt);
	const statusRow = new ActionRowBuilder();
	const set_voice_status = new ButtonBuilder()
		.setCustomId(getButtonIdString('channel', 'set_jtc_status', [channelInfo.id]))
		.setLabel('Set Channel Status')
		.setStyle(ButtonStyle.Primary);
	statusRow.addComponents(set_voice_status);

	return [permRow, typeRow, statusRow];
}
global.getJTCButtons = getJTCButtons;

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
			if (joinToCreateChannels.joinToCreateChannels[oldMemberState.channelId] !== 1) {
				if (newMemberState.channel) {
					oldMemberState.channel.send({
						content: `${oldMemberState.member} moved to ${newMemberState.channel}.`,
						allowedMentions: { parse: [] }
					}).catch(() => {});

				} else {
					oldMemberState.channel.send({
						content: `${oldMemberState.member} left the channel.`,
						allowedMentions: { parse: [] }
					}).catch(() => {});
				}
			}
		}
		if (newMemberState.channel) {
			if (joinToCreateChannels.joinToCreateChannels[newMemberState.channelId] === 1) {
				//user joined a join-to-create channel; create a new channel with the same parent and move the user to it
				let perm = getPermissionLevelForMember(guild, newMemberState.member);
				if (perm < PERM_MEMBER) {
					sendMessageToMember(newMemberState.member, 'You do not have permissions to create voice channels');
					newMemberState.disconnect().catch(error => {});
				} else {
					//FIXME what what if the member creates mulitple channels?
					let tempChannelName = `${newMemberState.member.nickname}'s Channel`;
					tempChannelName = tempChannelName.replace(/^\[\w+\]/g, '');
					let type = 'voice';
					let level = 'role';
					let category = guild.channels.resolve(newMemberState.channel.parentId);
					let officerRoleName = category.name + ' ' + config.discordOfficerSuffix;
					let memberRoleName = category.name + ' ' + config.discordMemberSuffix;
					let officerRole = guild.roles.cache.find(r => { return r.name == officerRoleName; });
					let memberRole = guild.roles.cache.find(r => { return r.name == memberRoleName; });
					let tempChannel = await addChannel(guild, null, newMemberState.member, perm, tempChannelName, type, level,
						category, officerRole, memberRole, newMemberState.member);
					if (tempChannel) {
						newMemberState.member.voice.setChannel(tempChannel).catch(error => {});
						joinToCreateChannels.tempChannels[tempChannel.id] = newMemberState.member.id;
						fs.writeFileSync(config.joinToCreateChannels, JSON.stringify(joinToCreateChannels), 'utf8');

						const channelInfo = await getChannelInfo(guild, tempChannel);
						const buttons = getJTCButtons(channelInfo, newMemberState.member);
						tempChannel.send({ components: buttons });
					} else {
						sendMessageToMember(newMemberState.member, 'Failed to create voice channel');
						newMemberState.disconnect().catch(error => {});
					}
				}
			} else {
				voiceStatusUpdates[newMemberState.member.id] = (new Date()).getTime();
				if (oldMemberState.channel) {
					newMemberState.channel.send({
						content: `${newMemberState.member} joined the channel from ${oldMemberState.channel}.`,
						allowedMentions: { parse: [] }
					}).catch(() => {});
				} else {
					newMemberState.channel.send({
						content: `${newMemberState.member} joined the channel.`,
						allowedMentions: { parse: [] }
					}).catch(() => {});
				}
			}
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
			`SELECT u.userid,u.username,u.usergroupid,u.membergroupids,f.field11,` +
			`  (CASE WHEN (r.requester_id IS NOT NULL) THEN 1 ELSE 0 END) AS pending, t.name AS pending_name ` +
			`FROM ${config.mysql.prefix}user AS u ` +
			`INNER JOIN ${config.mysql.prefix}userfield AS f ON u.userid=f.userid ` +
			`LEFT JOIN ${config.mysql.trackerPrefix}member_requests AS r ON u.userid=r.member_id AND r.approver_id IS NULL ` +
			`  AND r.cancelled_at IS NULL AND r.hold_placed_at IS NULL AND r.created_at > (NOW() - INTERVAL 24 HOUR) ` +
			`LEFT JOIN ${config.mysql.trackerPrefix}members AS t on u.userid=t.clan_id ` +
			`WHERE f.field20="${member.user.id}" OR f.field19 LIKE "${convertDiscordTag(member.user.tag)}"`;
		db.query(query, function(err, rows, fields) {
			if (err) {
				console.log(err);
				reject('Database error');
			} else {
				if (rows === undefined || rows.length === 0) {
					return resolve();
				}
				if (rows.length > 1) { //danger will robinson! name conflict in database
					member.send(`Hello ${member.displayName}! There is a conflict with your discord name. Please verify your profile and contact the leadership for help.`).catch(() => {});
					return reject(`Member name conflict: ${rows.length} members have the discord tag ${member.user.tag}`);
				}
				let row = rows.shift();
				let forumGroups = [];
				if (row.usergroupid !== undefined) {
					if (row.pending) {
						let guestGroupId = forumIntegrationConfig[config.guestRole].forumGroups[0];
						let memberGroupId = forumIntegrationConfig[config.memberRole].forumGroups[0];
						//if member is pending, overwrite primary group id to member group id
						if (row.usergroupid == guestGroupId) {
							row.usergroupid = memberGroupId;
						} else {
							row.pending = false;
						}
					}
					forumGroups.push('' + row.usergroupid);
				}
				if (row.membergroupids !== undefined && row.membergroupids !== '') {
					forumGroups = forumGroups.concat(row.membergroupids.split(','));
				}
				return resolve({ name: getDiscordNickname(row.pending ? row.pending_name : row.username, row.field11), groups: forumGroups, pending: row.pending });
			}
		});
	});
	return promise;
}

function setRolesForMember(guild, member, reason) {
	let promise = new Promise(function(resolve, reject) {
		getForumGroupsForMember(member)
			.then(async function(data) {
				let authCommand = client.application.commands.cache.find(c => c.name === 'authlink');
				let helpCommand = client.application.commands.cache.find(c => c.name === 'help');

				if (data === undefined || data.groups.length === 0) {
					const helpRow = global.getHelpButtons(guild);
					await sendMessageToMember(member, {
						content: `Hello ${member.displayName}! Welcome to the ClanAOD.net Discord. Roles in our server are based on forum permissions. ` +
							`Use </authlink:${authCommand.id}> to associate your Discord user to our [Forums](https://www.clanaod.net/forums/).`,
						components: [helpRow]
					});
					return resolve([]);
				}

				let rolesByGroup = getRolesByForumGroup(member.guild);
				let rolesToAdd = [],
					existingRoles = [];
				for (let i = 0; i < data.groups.length; i++) {
					let group = data.groups[i];
					if (rolesByGroup[group] !== undefined) {
						for (let roleName of Object.keys(rolesByGroup[group])) {
							let role = rolesByGroup[group][roleName];
							let hasRole = !!member.roles.cache.get(role.id);
							if (hasRole)
								existingRoles.push(role);
							else
								rolesToAdd.push(role);
						}
					}
				}

				if (rolesToAdd.length) {
					try {
						await member.roles.add(rolesToAdd, reason);
					} catch (error) {
						console.log(error);
						return reject();
					}
					let added = rolesToAdd.map(r => r.name).join(',');
					console.log(`Updated ${member.user.tag} (added: ${added}), ${reason}`);
				} else if (!existingRoles.length) {
					const helpRow = global.getHelpButtons(guild);
					await sendMessageToMember(member, {
						content: `Hello ${member.displayName}! Welcome to the ClanAOD.net Discord. Roles in our server are based on forum permissions. ` +
							`Use </authlink:${authCommand.id}> to associate your Discord user to our [Forums](https://www.clanaod.net/forums/).`,
						components: [helpRow]
					});
					return resolve([]);
				}

				if (member.displayName !== data.name) {
					try {
						await member.setNickname(data.name, reason);
					} catch (error) {}
				}
				let roles = existingRoles.concat(rolesToAdd);
				await member.send(`Hello ${data.name}! The following roles have been granted: ${roles.map(r=>r.name).join(', ')}. Use </help:${helpCommand.id}> to see available commands.`).catch(() => {});
				resolve(rolesToAdd);
			})
			.catch(error => {
				console.log(error);
				reject();
			});
	});
	return promise;
}
global.setRolesForMember = setRolesForMember;

//guildMemberAdd event handler -- triggered when a user joins the guild
client.on('guildMemberAdd', member => {
	setRolesForMember(member.guild, member, 'First time join')
		.catch(console.log);
});

async function checkAddDependentRoles(guild, role, member, message) {
	let roleId = '' + role.id;
	if (dependentRoles.requiredFor[roleId] !== undefined) {
		let potentialRoleIDs = dependentRoles.requiredFor[roleId];
		for (let i = 0; i < potentialRoleIDs.length; i++) {
			let potentialRoleID = potentialRoleIDs[i];
			if (roleId === potentialRoleID) {
				//recursive add???
				continue;
			}
			let requiredRoleIDs = dependentRoles.requires[potentialRoleID];
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
			if (!member.roles.resolve(potentialRoleID)) {
				if (add) {
					//all roles are present
					await addRemoveRole(message, guild, true, potentialRoleID, member, true);
				}
			} else {
				if (!add) {
					//roles are missing
					await addRemoveRole(message, guild, false, potentialRoleID, member, true);
				}
			}
		}
	}
	return Promise.resolve();
}
global.checkAddDependentRoles = checkAddDependentRoles;

async function checkRemoveDependentRoles(guild, role, member) {
	let roleId = '' + role.id;
	if (dependentRoles.requiredFor[roleId] !== undefined) {
		let requiredForIDs = dependentRoles.requiredFor[roleId];
		for (let i = 0; i < requiredForIDs.length; i++) {
			if (roleId === requiredForIDs[i]) {
				//recursive remove???
				continue;
			}
			await addRemoveRole(null, guild, false, requiredForIDs[i], member, true);
		}
	}
	return Promise.resolve();
}

client.on('guildMemberUpdate', async (oldMember, newMember) => {
	const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
	removedRoles.forEach(async (r) => {
		console.log(`Dependent role ${r.name} removed from ${newMember.user.tag}`);
		await checkRemoveDependentRoles(newMember.guild, r, newMember);
	});
	const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
	addedRoles.forEach(async (r) => {
		console.log(`Dependent role ${r.name} added to ${newMember.user.tag}`);
		await checkAddDependentRoles(newMember.guild, r, newMember);
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
		.catch(console.log);

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
	if (message.guildId && message.channel && message.content &&
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
client.on('ready', async function() {
	//remove any empty temp channels
	const guild = client.guilds.resolve(config.guildId);
	console.log(`Bot has started, with ${client.users.cache.size} users, in ${client.channels.cache.size} channels of ${client.guilds.cache.size} guilds.`);

	await guild.members.fetch().catch(console.log);
	await guild.roles.fetch().catch(console.log);
	await guild.commands.fetch().catch(console.log);
	await client.application.commands.fetch().catch(console.log);
	console.log(`Data fetch complete`);

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

//GuildAuditLogEntryCreate handler -- Triggers when an audit log entry is created
client.on('guildAuditLogEntryCreate', async function(auditLogEntry, guild) {
	// Ignore actions issued by the bot to avoid double logging.
	// These events will be logged from within the commands.
	if (auditLogEntry.executorId === client.user.id || auditLogEntry.executorId === auditLogEntry.targetId) {
		return;
	}

	let actionDescription;
	switch (auditLogEntry.action) {
		case AuditLogEvent.MemberKick:
			actionDescription = 'kicked';
			break;
		case AuditLogEvent.MemberBanAdd:
			actionDescription = 'banned';
			break;
		case AuditLogEvent.MemberUpdate:
			// Determine if the MemberUpdate event is a timeout (communication_disabled_until)
			auditLogEntry.changes.forEach(change => {
				if (change.key === 'communication_disabled_until') {
					if (change.new) {
						let timeoutEnd = new Date(change.new).toLocaleString();
						actionDescription = `timed out until ${timeoutEnd}`;
					} else {
						actionDescription = `removed from timeout`;
					}
				}
			});

			if (actionDescription === undefined) {
				console.log(`Unsupported MemberUpdate on ${auditLogEntry.target.username} by ${auditLogEntry.executor.username}: ${JSON.stringify(auditLogEntry.changes)}`);
				return;
			}

			break;
		default:
			return;
	}

	let reason = auditLogEntry.reason ?? 'No reason provided';
	await global.sendGlobalNotification(guild, `${auditLogEntry.target} has been ${actionDescription} by ${auditLogEntry.executor} for: ${reason}`);
});


async function checkGuildEvent(event) {
	let member = event.guild.members.resolve(event.creator.id);
	if (!member) {
		//???
		return event.delete();
	}
	let perm = getPermissionLevelForMember(event.guild, member);
	const divisions = await getDivisionsFromTracker();
	if (!event.channel) {
		await sendMessageToMember(event.creator, 'Events must occur in a voice channel. Please recreate your event.');
		return event.delete();
	}
	if (event.channel.parent) {
		if (!divisions[event.channel.parent.name]) {
			if (perm < PERM_STAFF) {
				await sendMessageToMember(event.creator, 'You do not have permission to create events outside your division.');
				return event.delete();
			}
		} else if (!event.name.startsWith(event.channel.parent.name)) {
			await event.setName(`${event.channel.parent.name} - ${event.name}`);
			await sendMessageToMember(event.creator, `Your event has been renamed to "${event.name}"`);
		}
	} else {
		if (perm < PERM_STAFF) {
			await sendMessageToMember(event.creator, 'You do not have permission to create events outside your division.');
			return event.delete();
		}
	}
}
//guildScheduledEventCreate handler
client.on('guildScheduledEventCreate', async function(event) {
	checkGuildEvent(event);
});

//guildScheduledEventUpdate handler
client.on('guildScheduledEventUpdate', async function(oldEvent, newEvent) {
	checkGuildEvent(newEvent);
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
client.on('error', console.log);

function doLogin() {
	client.login(config.token)
		.catch(e => {
			console.log('Client login failed');
			console.log(e);
			setTimeout(doLogin, 5000);
		});
}
//everything is defined, start the client
doLogin();

startAPIServer();
