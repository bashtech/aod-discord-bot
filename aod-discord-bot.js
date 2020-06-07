#!/bin/node

/**
 * ClanAOD.net discord integration bot
 * 
 * Author: Adam Schultz <archangel122184@gmail.com>
 */

/*jshint esversion: 8 */

//include discord.js
const Discord = require('discord.js');

//include request
var request = require('request');

//include entities
const Entities = require('html-entities').AllHtmlEntities;
const entities = new Entities();

//include config
var config = require('./aod-discord-bot.config.json');

//inclue fs
const fs = require('fs');

//include md5
var md5 = require('md5');

//include AOD group config
var forumIntegrationConfig;
try {
	forumIntegrationConfig = require(config.forumGroupConfig);
} catch (error) {
	forumIntegrationConfig = {};
}

//include saved timers
var savedTimers;
try {
	savedTimers = require(config.savedTimers);
} catch (error) {
	savedTimers = [];
}

//include subscribableRoles
var subscribableRoles;
try {
	subscribableRoles = require(config.subscribableRoles);
} catch (error) {
	subscribableRoles = {};
}
var assignableRoles;
try {
	assignableRoles = require(config.assignableRoles);
} catch (error) {
	assignableRoles = {};
}


//permission levels
const PERM_OWNER = 10;
const PERM_ADMIN = 9;
const PERM_STAFF = 8;
const PERM_DIVISION_COMMANDER = 7;
const PERM_MOD = 6;
const PERM_RECRUITER = 5;
const PERM_MEMBER = 4;
const PERM_GUEST = 1;
const PERM_NONE = 0;

//global undefined for readable code
var undefined;

//other globals
var lastForumSync;

//initialize client
const client = new Discord.Client({
	sync: true
});


/*************************************
	Utility Functions
 *************************************/

Object.defineProperty(global, '__stack', {
	get: function() {
		var orig = Error.prepareStackTrace;
		Error.prepareStackTrace = function(_, stack) {
			return stack;
		};
		var err = new Error();
		Error.captureStackTrace(err, arguments.callee);
		var stack = err.stack;
		Error.prepareStackTrace = orig;
		return stack;
	}
});

Object.defineProperty(global, '__caller_line', {
	get: function() {
		return __stack[2].getLineNumber();
	}
});

Object.defineProperty(global, '__caller_function', {
	get: function() {
		return __stack[2].getFunctionName();
	}
});

function asyncWrapper(promise) {
	return promise
		.then(data => [null, data])
		.catch(error => [error, null]);
}

var rolesByForumGroup = null;

function getRolesByForumGroup(guild, doUpdate) {
	if (!doUpdate && rolesByForumGroup !== null)
		return rolesByForumGroup;

	rolesByForumGroup = {};

	Object.keys(forumIntegrationConfig).forEach(roleName => {
		var groupMap = forumIntegrationConfig[roleName];
		var role;
		if (groupMap.roleID === undefined) {
			const role = guild.roles.find(r => { return r.name == roleName; });
			if (role)
				groupMap.roleID = role.id;
		} else
			role = guild.roles.get(groupMap.roleID);
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
var mysql = require('mysql');
var mysqlConnection = null;

function connectToDB() {
	if (mysqlConnection !== null && mysqlConnection.state !== 'disconnected')
		return mysqlConnection;
	mysqlConnection = mysql.createConnection(config.mysql);
	mysqlConnection.connect(error => {
		if (error)
			notifyRequestError(error, null, false);
	});
	mysqlConnection
		.on('close', error => {
			if (error) {
				notifyRequestError(error, null, false);
				connectToDB();
			}
		})
		.on('error', error => {
			notifyRequestError(error, null, false);
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
			return message.author.username;
	}
	return "<unknown>";
}

//get the guild member object from the message
function getMemberFromMessageOrArgs(guild, message, args) {
	var member;
	if (message.mentions && message.mentions.members)
		member = message.mentions.members.first();
	if (!member) {
		if (args.length > 0) {
			member = guild.members.get(args[0]);
			if (!member) {
				let tag = args[0];
				member = guild.members.find(m => { return m.user.tag === tag; });
			}
		}
	}
	return member;
}

//add or remove a role from a guildMember
function addRemoveRole(message, guild, add, roleName, isID, member) {
	if (!guild)
		return message.reply("Invalid Guild");
	var role;
	if (isID === true)
		role = guild.roles.get(roleName);
	else
		role = guild.roles.find(r => { return r.name == roleName; });
	if (!role)
		return message.reply("Invalid Role");
	if (!member)
		return message.reply("Please mention a valid member of this server");

	if (add)
		member.addRole(role, `Requested by ${getNameFromMessage(message)}`)
		.then(message.reply("Added " + role.name + " to " + member.user.tag))
		.catch(error => { notifyRequestError(error, null, false); });
	else
		member.removeRole(role, `Requested by ${getNameFromMessage(message)}`)
		.then(message.reply("Removed " + role.name + " from " + member.user.tag))
		.catch(error => { notifyRequestError(error, null, false); });
}

//map roles to permissions based on config
function getPermissionLevelForMember(member) {
	if (member.permissions.bitfield & 0x00000008)
		return [PERM_OWNER, "Admin"];

	const r = member.highestRole;
	if (r) {
		if (config.adminRoles.includes(r.name))
			return [PERM_ADMIN, 'Admin'];
		else if (config.staffRoles.includes(r.name))
			return [PERM_STAFF, 'Staff'];
		else if (config.divisionCommandRoles.includes(r.name))
			return [PERM_DIVISION_COMMANDER, 'Division Commander'];
		else if (config.modRoles.includes(r.name))
			return [PERM_MOD, 'Moderator'];
		else if (r.name.endsWith('Officer') || config.recruiterRoles.includes(r.name))
			return [PERM_RECRUITER, 'Recruiter'];
		else if (config.memberRole == r.name)
			return [PERM_MEMBER, 'Member'];
		else if (config.guestRole == r.name)
			return [PERM_GUEST, 'Guest'];
	}
	return [PERM_NONE, '<none>'];
}

//add view to the permissions list of a role in the server
function addRoleToPermissions(guild, role, permissions, allow, deny) {
	if (!role)
		return permissions;

	permissions.push({
		type: 'role',
		id: role.id,
		allow: (Array.isArray(allow) ? allow : ['VIEW_CHANNEL', 'CONNECT']),
		deny: (Array.isArray(deny) ? deny : []),
	});

	return permissions;
}
//build a list of permissions for admin
function getPermissionsForAdmin(guild, defaultAllow, defaultDeny, allow, deny) {
	let permissions = [{
		id: guild.id,
		allow: (Array.isArray(defaultAllow) ? defaultAllow : []),
		deny: (Array.isArray(defaultDeny) ? defaultDeny : ['VIEW_CHANNEL', 'CONNECT'])
	}];

	const muteRole = guild.roles.find(r => { return r.name == config.muteRole; });
	permissions = addRoleToPermissions(guild, muteRole, permissions, [], ['SEND_MESSAGES', 'SEND_TTS_MESSAGES', 'SPEAK']);
	const pttRole = guild.roles.find(r => { return r.name == config.pttRole; });
	permissions = addRoleToPermissions(guild, pttRole, permissions, [], ['USE_VAD']);

	// add admin
	config.adminRoles.forEach(n => {
		const role = guild.roles.find(r => { return r.name == n; });
		if (role)
			permissions = addRoleToPermissions(guild, role, permissions, allow, deny);
	});
	return permissions;
}
//build a list of permissions for staff+
function getPermissionsForStaff(guild, defaultAllow, defaultDeny, allow, deny) {
	let permissions = getPermissionsForAdmin(guild, defaultAllow, defaultDeny, allow, deny);
	// add staff
	config.staffRoles.forEach(n => {
		const role = guild.roles.find(r => { return r.name == n; });
		permissions = addRoleToPermissions(guild, role, permissions, allow, deny);
	});
	return permissions;
}
//build a list of permissions for mod+
function getPermissionsForModerators(guild, defaultAllow, defaultDeny, allow, deny) {
	let permissions = getPermissionsForStaff(guild, defaultAllow, defaultDeny, allow, deny);
	// add moderators
	config.modRoles.forEach(n => {
		const role = guild.roles.find(r => { return r.name == n; });
		if (role)
			permissions = addRoleToPermissions(guild, role, permissions, allow, deny);
	});
	return permissions;
}
//build a list of permissions for member+
function getPermissionsForMembers(guild, defaultAllow, defaultDeny, allow, deny) {
	let permissions = getPermissionsForModerators(guild, defaultAllow, defaultDeny, allow, deny);
	const memberRole = guild.roles.find(r => { return r.name == config.memberRole; });
	return addRoleToPermissions(guild, memberRole, permissions, allow, deny);
}
//build a list of permissions for guest+
function getPermissionsForEveryone(guild, defaultAllow, defaultDeny, allow, deny) {
	let permissions = getPermissionsForMembers(guild, defaultAllow, defaultDeny, allow, deny);
	const guestRole = guild.roles.find(r => { return r.name == config.guestRole; });
	return addRoleToPermissions(guild, guestRole, permissions, allow, deny);
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

	const guild = client.guilds.get(config.guildId);
	let doSave = false;

	while (savedTimers.length > 0) {
		let currEpoch = (new Date()).getTime();
		let firstTimer = savedTimers[0];

		if (currEpoch < firstTimer.epoch)
			break;
		savedTimers.shift();
		doSave = true;

		switch (firstTimer.type) {
			case 'test': {
				const member = guild.members.get(firstTimer.data.memberID);
				if (member)
					member.send('Your test timer has expired').catch(() => {});
				break;
			}
			default: {
				console.error(`Unknown timer type: ${firstTimer.type}`);
			}
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
			nextSavedTimer = client.setTimeout(savedTimerExpired, delta);
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

/*************************************
	Command Processing Functions
 *************************************/

//forward declaration of commands in case any of the functions need it
var commands;

//params parsing
var paramsRegEx = /([^\s"'\u201C]+)|"(((\\")|([^"]))*)"|'(((\\')|([^']))*)'|\u201C([^\u201D]*)\u201D/g; //BE CAREFUL OF CAPTURE GROUPS BELOW
var paramsReplaceEscapedSingleRegEx = /\\'/g;
var paramsReplaceExcapedDoubleRegEx = /\\"/g;

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
			params.push(param);
		}
	} while (match != null);
	return params;
}

//log and notify of errors processing commands
function notifyRequestError(error, message, showError) {
	if (!error)
		return;
	console.error(`Error from ${__caller_function}:${__caller_line}: ${error.toString()}`);
	if (showError && message && message.member) {
		message.member.send('An error occurred while processing your request: ' + message.content + "\n" + error.toString())
			.catch(console.error);
	}
}

function asyncNotifyRequestError(promise, message, showError) {
	return promise
		.then(data => [null, data])
		.catch(error => {
			notifyRequestError(error, message, showError);
			return [error, null];
		});
}

function sendMessageToMember(member, data) {
	if (member)
		return member.send(data);
	var promise = new Promise(function(resolve, reject) {
		reject();
	});
	return promise;
}


//send a reply as DM to the author of a message (if available) and return a promise
function sendReplyToMessageAuthor(message, data) {
	if (message)
		return sendMessageToMember(message.member, data);
	var promise = new Promise(function(resolve, reject) {
		reject();
	});
	return promise;
}

//help command processing
function commandHelp(message, cmd, args, guild, perm, permName, isDM) {
	var filter;
	var detail = (perm == PERM_NONE ? true : false);
	var footer = "**Note**: Parameters that require spaces must be 'single' or \"double\" quoted.";
	if (args.length) {
		detail = true;
		filter = args.shift();
	}
	var embed = {
		title: `User Level: **${permName}** Commands`,
		description: detail ? "" : "Use !help <cmd> to see the details of each command.\n\n",
		fields: [],
		footer: { text: footer }
	};

	Object.keys(commands).forEach(cmd => {
		let commandObj = commands[cmd];
		if (commandObj.minPermission <= perm && (!filter || filter === cmd)) {
			let commandArgsText = commandObj.args;
			if (Array.isArray(commandArgsText))
				commandArgsText = commandArgsText.join(" ");

			if (detail) {
				let commandHelpText = commandObj.helpText;
				if (Array.isArray(commandHelpText))
					commandHelpText = commandHelpText.join("\n> ");
				if (commandHelpText !== '')
					embed.fields.push({
						name: `${cmd} ${commandArgsText}`,
						value: commandHelpText
					});
				if (embed.fields.length >= 25) {
					sendReplyToMessageAuthor(message, { embed: embed })
						.catch(error => { notifyRequestError(error, message, (perm >= PERM_MOD)); });
					embed = {
						title: `Continued...`,
						description: "",
						fields: [],
						footer: { text: footer }
					};
				}
			} else {
				var line = `${cmd} ${commandArgsText}\n`;
				if (commandObj.dmOnly === true)
					line = "***(DM ONLY)*** " + line;
				if (embed.description.length + line.length < 2048) {
					embed.description = embed.description + line;
				} else {
					sendReplyToMessageAuthor(message, { embed: embed })
						.catch(error => { notifyRequestError(error, message, (perm >= PERM_MOD)); });
					embed = {
						title: `Continued...`,
						description: "",
						fields: [],
						footer: { text: footer }
					};
				}
			}
		}
	});
	if (embed.fields.length || embed.description.length)
		sendReplyToMessageAuthor(message, { embed: embed })
		.catch(error => { notifyRequestError(error, message, (perm >= PERM_MOD)); });
}

//ping command processing
function commandPing(message, cmd, args, guild, perm, permName, isDM) {
	if (perm >= PERM_STAFF)
		sendReplyToMessageAuthor(message, "Ping?")
		.then(m => { m.edit(`Pong! Latency is ${m.createdTimestamp - message.createdTimestamp}ms. API Latency is ${Math.round(client.ping)}ms`).catch(error => { notifyRequestError(error, message, (perm >= PERM_MOD)); }); })
		.catch(error => { notifyRequestError(error, message, (perm >= PERM_MOD)); });
	else
		sendReplyToMessageAuthor(message, "Pong!")
		.catch(error => { notifyRequestError(error, message, (perm >= PERM_MOD)); });
}

//login command processing
var loginErrorsByUserID = [];
async function commandLogin(message, cmd, args, guild, perm, permName, isDM) {
	var member = message.member;
	if (!isDM) {
		message.delete();
		sendMessageToMember(member, `***WARNING:*** You have entered your credentials into a public channel. Your password may be compromised. Please change your password immediately.`).catch(() => {});
	}

	if (args.length < 2)
		return sendMessageToMember(member, "Username and Password must be provided.").catch(() => {});

	var username = args.shift();
	var password = args.shift();

	//check for failed login attempts
	if (loginErrorsByUserID[member.user.id] !== undefined) {
		let currEpochMs = (new Date()).getTime();
		let loginError = loginErrorsByUserID[member.user.id];
		if ((loginError.epochMs + config.forumLoginErrorTimeoutMs) > currEpochMs) {
			if (loginError.count >= config.maxForumLoginAttempts) {
				loginError.epochMs = currEpochMs;
				let minutes = Math.round(config.forumLoginErrorTimeoutMs / 60000);
				console.log(`${member.user.tag} login failed for ${username} (too many attempts)`);
				return sendMessageToMember(member, `You have too many failed login attempts. Please wait ${minutes} minutes and try again.`).catch(() => {});
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
		db.query(query, function(err, rows, fields) {
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
						db.query(query2, function(err, rows2, fields) {
							if (rows2 && rows2.length) {
								let data2 = rows2[0];
								const sgtsChannel = guild.channels.find(c => { return c.name === 'aod-sergeants'; });
								console.log(`Existing forum account found ${data2.username} ${data2.userid}`);
								if (sgtsChannel) {
									sgtsChannel.send(`${member.user.tag} logged in as ${data.username} but was already known as ${data2.username}`).catch(() => {});
								}
								query2 = `UPDATE ${config.mysql.prefix}userfield SET field19='',field20='' WHERE userid=${data2.userid}`;
								db.query(query2);
							}
						});

						query2 = `UPDATE ${config.mysql.prefix}userfield SET field19=${tag},field20=${discordId} WHERE userid=${data.userid}`;
						db.query(query2, function(err, rows2, fields) {
							if (err) {
								sendMessageToMember(member, `Successfully logged in as ${data.username} (${data.userid}), but there was an error updating your user infomation.`).catch(() => {});
								console.log(err);
								return reject(err);
							}
							console.log(`${member.user.tag} logged in as ${data.username} (${data.userid})`);
							let msg = `Successfully logged in as ${data.username} (${data.userid}).`;
							if (isDM)
								msg += ` We recommend you delete the \`${config.prefix}login\` message from your history to protect your identity.`;
							sendMessageToMember(member, msg);
							setRolesForMember(member, "Forum login");
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
				sendMessageToMember(member, `Login failed for ${username}.`).catch(() => {});
			}
			return resolve();
		});
	});
	return promise;
}

//aod command processing
function commandSetAOD(message, cmd, args, guild, perm, permName, isDM) {
	return addRemoveRole(message, guild, cmd === 'addaod', config.memberRole, false, getMemberFromMessageOrArgs(guild, message, args));
}

//guest command processing
function commandSetGuest(message, cmd, args, guild, perm, permName, isDM) {
	return addRemoveRole(message, guild, cmd === 'addguest', config.guestRole, false, getMemberFromMessageOrArgs(guild, message, args));
}

//purge command processing
function commandPurge(message, cmd, args, guild, perm, permName, isDM) {
	if (isDM)
		return message.reply("Must be executed in a text channel");

	var deleteCount = parseInt(args[0], 10);

	if (!deleteCount || deleteCount < 1 || deleteCount > 100)
		return message.reply("Please provide a number between 1 and 100 for the number of messages to delete");
	deleteCount++; //remove the request to purge as well

	message.channel.fetchMessages({ limit: deleteCount })
		.then(fetched => message.channel.bulkDelete(fetched)
			.catch(error => message.reply(`Couldn't delete messages because of: ${error}`)))
		.catch(error => message.reply(`Couldn't delete messages because of: ${error}`));
}

var channelPermissionLevels = ['feed', 'guest', 'member', 'officer', 'mod', 'staff', 'admin'];

function getChannelPermissions(guild, perm, level, type, divisionRole) {
	//get permissions based on type
	var defaultDeny;
	if (type == 'ptt')
		defaultDeny = ['VIEW_CHANNEL', 'CONNECT', 'USE_VAD'];
	else
		defaultDeny = ['VIEW_CHANNEL', 'CONNECT'];

	var permissions;
	switch (level) {
		case 'guest':
			if (perm < PERM_MOD) {
				message.reply("You don't have permissions to add this channel type");
				return null;
			}
			permissions = getPermissionsForEveryone(guild, [], defaultDeny);
			//add role permissions if necessary
			if (divisionRole)
				permissions = addRoleToPermissions(guild, divisionRole, permissions, ['VIEW_CHANNEL', 'CONNECT', 'MANAGE_MESSAGES']);
			break;
		case 'mod':
			if (perm < PERM_MOD) {
				message.reply("You don't have permissions to add this channel type");
				return null;
			}
			permissions = getPermissionsForModerators(guild, [], defaultDeny);
			break;
		case 'officer':
			if (perm < PERM_MOD) {
				message.reply("You don't have permissions to add this channel type");
				return null;
			}
			if (!divisionRole) {
				message.reply("No officer role could be determined");
				return null;
			}
			permissions = getPermissionsForModerators(guild, [], defaultDeny);
			permissions = addRoleToPermissions(guild, divisionRole, permissions, ['VIEW_CHANNEL', 'CONNECT']);
			break;
		case 'staff':
			if (perm < PERM_STAFF) {
				message.reply("You don't have permissions to add this channel type");
				return null;
			}
			permissions = getPermissionsForStaff(guild, [], defaultDeny);
			break;
		case 'admin':
			if (perm < PERM_ADMIN) {
				message.reply("You don't have permissions to add this channel type");
				return null;
			}
			permissions = getPermissionsForAdmin(guild, [], defaultDeny);
			break;
		case 'feed':
			if (type !== 'text') {
				message.reply("Feed may only be used for text channels");
				return null;
			}
			if (perm < PERM_DIVISION_COMMANDER) {
				message.reply("You don't have permissions to add this channel type");
				return null;
			}
			//get permissions for staff -- add manage webhooks
			permissions = getPermissionsForStaff(guild, [], defaultDeny, ['VIEW_CHANNEL', 'CONNECT', 'SEND_MESSAGES', 'MANAGE_WEBHOOKS']);
			//add moderators
			config.modRoles.forEach(n => {
				const role = guild.roles.find(r => { return r.name == n; });
				if (role)
					permissions = addRoleToPermissions(guild, role, permissions, ['VIEW_CHANNEL', 'CONNECT', 'SEND_MESSAGES']);
			});
			//add member/guest as read only
			const memberRole = guild.roles.find(r => { return r.name == config.memberRole; });
			permissions = addRoleToPermissions(guild, memberRole, permissions, ['VIEW_CHANNEL'], ['SEND_MESSAGES', 'SEND_TTS_MESSAGES', 'SPEAK']);
			const guestRole = guild.roles.find(r => { return r.name == config.guestRole; });
			permissions = addRoleToPermissions(guild, guestRole, permissions, ['VIEW_CHANNEL'], ['SEND_MESSAGES', 'SEND_TTS_MESSAGES', 'SPEAK']);
			//add role permissions if necessary
			if (divisionRole)
				permissions = addRoleToPermissions(guild, divisionRole, permissions, ['VIEW_CHANNEL', 'CONNECT', 'SEND_MESSAGES', 'MANAGE_MESSAGES']);
			break;
		default: //member
			permissions = getPermissionsForMembers(guild, [], defaultDeny);
			//add role permissions if necessary
			if (divisionRole)
				permissions = addRoleToPermissions(guild, divisionRole, permissions, ['VIEW_CHANNEL', 'CONNECT', 'SEND_MESSAGES', 'MANAGE_MESSAGES']);
			break;
	}
	return permissions;
}

//voice command processing
function commandAddChannel(message, cmd, args, guild, perm, permName, isDM) {
	var temp = true;
	var channelCategory;
	var divisionRole;

	if (args[0] === undefined)
		return message.reply("Invalid parameters");

	if ((channelCategory = guild.channels.find(c => { return (c.name.toLowerCase() == args[0].toLowerCase() && c.type == 'category'); }))) {
		//check if this category has an associated officer role
		let roleName = channelCategory.name + ' ' + config.discordOfficerSuffix;
		divisionRole = guild.roles.find(r => { return r.name == roleName; });

		if (perm < PERM_DIVISION_COMMANDER)
			return message.reply("You may not create a permanent channel");
		if (perm == PERM_DIVISION_COMMANDER && (!divisionRole || !message.member.roles.get(divisionRole.id)))
			return message.reply("You may only add channels to a division you command");
		if (channelCategory.type != 'category')
			return message.reply("Mentioned channel must be a category");
		if (perm < PERM_ADMIN && channelCategory.children.size >= config.maxChannelsPerCategory)
			return message.reply("Category is full");
		args.shift();
		temp = false;
	} else {
		if (cmd === 'text')
			return message.reply("A category must be set for text channels");
		//make sure category exists
		channelCategory = guild.channels.find(c => { return c.name == config.tempChannelCategory; });
		if (!channelCategory)
			return message.reply("Temp channel category not found");
	}

	if (args[0] === undefined)
		return message.reply("Invalid parameters");

	//process level argument if present
	var level = "member";
	if (channelPermissionLevels.includes(args[0])) {
		level = args[0];
		args.shift();
	}

	if (args[0] === undefined)
		return message.reply("Invalid parameters");

	//check for existing channel
	let channelName = args.join(' ').toLowerCase().replace(/\s/g, '-');
	if (channelCategory) {
		let channelPrefix = channelCategory.name.toLowerCase().replace(/\s/g, '-') + '-';
		if (channelName.indexOf(channelPrefix) < 0)
			channelName = channelPrefix + channelName;
	}
	if (channelName === undefined || channelName == '')
		return message.reply("A name must be provided");

	var existingChannel = guild.channels.find(c => { return c.name == channelName; });
	if (existingChannel)
		return message.reply("Channel already exists");

	//get channel permissions
	var permissions = getChannelPermissions(guild, perm, level, cmd, divisionRole);
	if (!permissions)
		return;

	if (cmd === 'ptt') {
		channelName += '-ptt';
		cmd = 'voice';
	}

	//create channel
	return guild.createChannel(channelName, { type: cmd, name: channelName, parent: channelCategory, permissionOverwrites: permissions, bitrate: 96000, reason: `Requested by ${getNameFromMessage(message)}` })
		.then(c => {
			if (cmd === 'voice') {
				//make sure someone gets into the channel
				if (temp)
					client.setTimeout(function() {
						if (c.members.size === 0)
							c.delete()
							.catch(e => {}); //probably removed already
					}, 30000);
				//try to move the person requesting the channel to it
				if (message.member)
					message.member.setVoiceChannel(c).catch(error => {});
			}
			return message.reply(`Added channel ${c.toString()} in ${channelCategory.name}`);
		})
		.catch(error => { notifyRequestError(error, message, (perm >= PERM_MOD)); });
}

//set channel perms command processing
function commandSetPerms(message, cmd, args, guild, perm, permName, isDM) {
	if (args[0] === undefined)
		return message.reply("Invalid parameters");

	//process level argument if present
	var level = "member";
	if (channelPermissionLevels.includes(args[0])) {
		level = args[0];
		args.shift();
	}

	if (args[0] === undefined)
		return message.reply("Invalid parameters");

	//check for existing channel
	let channelName = args.join(' ').toLowerCase().replace(/\s/g, '-');
	if (channelName === undefined || channelName == '')
		return message.reply("A name must be provided");

	if (config.protectedChannels.includes(channelName))
		return message.reply(`${channelName} is a protected channel.`);

	var existingChannel = guild.channels.find(c => { return c.name == channelName; });
	if (!existingChannel || (existingChannel.type !== 'text' && existingChannel.type !== 'voice'))
		return message.reply("Channel not found");

	//check if we're in a category and get the proper division role
	var divisionCategory = existingChannel.parent;
	var divisionRole;
	if (divisionCategory) {
		var divisionRoleName = divisionCategory.name + " " + config.discordOfficerSuffix;
		divisionRole = guild.roles.find(r => { return r.name === divisionRoleName; });
	}

	//get channel permissions //FIXME: support PTT?
	var permissions = getChannelPermissions(guild, perm, level, existingChannel.type, divisionRole);
	if (!permissions)
		return;

	//replace channel permission overrides
	existingChannel.replacePermissionOverwrites({ overwrites: permissions, reason: `Requested by ${getNameFromMessage(message)}` })
		.then(() => { message.reply(`Channel ${channelName} permissions updated`); })
		.catch(error => {
			message.reply(`Failed to update channel ${channelName} permissions`);
			notifyRequestError(error, message, (perm >= PERM_MOD));
		});
}

//remove channel command processing
function commandRemChannel(message, cmd, args, guild, perm, permName, isDM) {
	//check for existing channel
	let channelName = args.join(' ').toLowerCase().replace(/\s/g, '-');
	if (channelName === undefined || channelName == '')
		return message.reply("A name must be provided");

	if (config.protectedChannels.includes(channelName))
		return message.reply(`${channelName} is a protected channel.`);

	var existingChannel = guild.channels.find(c => { return c.name == channelName; });
	if (!existingChannel || existingChannel.type === 'category')
		return message.reply("Channel not found");

	if (perm < PERM_DIVISION_COMMANDER)
		return message.reply("You may not delete this channel");

	var channelCategory = existingChannel.parent;
	if (channelCategory) {
		//check if this category has an associated officer role
		let roleName = channelCategory.name + ' ' + config.discordOfficerSuffix;
		divisionRole = guild.roles.find(r => { return r.name == roleName; });
		if (perm == PERM_DIVISION_COMMANDER && (!divisionRole || !message.member.roles.get(divisionRole.id)))
			return message.reply("You may only delete channels from a division you command");
	} else {
		if (perm < PERM_STAFF)
			return message.reply("You may not delete this channel");
	}

	existingChannel.delete(`Requested by ${getNameFromMessage(message)}`)
		.then(() => { message.reply(`Channel ${channelName} removed`); });
}

function commandTopic(message, cmd, args, guild, perm, permName, isDM) {
	if (args.length <= 0)
		return message.reply("A topic must be provided");

	let channelName = args[0].toLowerCase();
	if (config.protectedChannels.includes(channelName) && perm < PERM_STAFF)
		return message.reply(`${channelName} is a protected channel.`);

	let channel = guild.channels.find(c => { return (c.name.toLowerCase() == channelName); });
	if (channel)
		args.shift();
	else if (message.channel.type === 'text')
		channel = message.channel;

	if (args.length <= 0)
		return message.reply("A topic must be provided");

	if (channel)
		channel.setTopic(args.join(' '), `Requested by ${getNameFromMessage(message)}`)
		.catch(error => { notifyRequestError(error, message, (perm >= PERM_MOD)); });
	else
		return message.reply("Channel not found");
}

//move channel command processing
function commandMoveChannel(message, cmd, args, guild, perm, permName, isDM) {
	//check for existing channel
	let channelName = args.join(' ');
	if (channelName === undefined || channelName == '')
		return message.reply("A name must be provided");

	if (config.protectedChannels.includes(channelName))
		return message.reply(`${channelName} is a protected channel.`);

	var existingChannel = guild.channels.find(c => { return c.name == channelName; });
	if (existingChannel)
		existingChannel.setPosition(cmd === 'up' ? -1 : 1, {relative: true, reason: `Requested by ${getNameFromMessage(message)}`})
		.then(() => { message.reply(`Channel ${channelName} moved`); })
		.catch(error => { notifyRequestError(error, message, (perm >= PERM_MOD)); });
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

//adddivision command processing
async function commandAddDivision(message, cmd, args, guild, perm, permName, isDM) {
	let divisionName = args.join(' ');
	if (divisionName === undefined || divisionName == '')
		return message.reply("A name must be provided");
	let roleName = divisionName + ' ' + config.discordOfficerSuffix;
	let simpleName = divisionName.toLowerCase().replace(/\s/g, '-');
	let divisionMembersChannel = simpleName + '-members';
	let divisionOfficersChannel = simpleName + '-officers';
	let divisionPublicChannel = simpleName + '-public';
	let divisionMemberVoiceChannel = simpleName + '-member-voip';

	var divisionCategory = guild.channels.find(c => { return (c.name == divisionName && c.type == 'category'); });
	if (divisionCategory)
		return message.reply("Division already exists.").catch(() => {});
	var divisionRole = guild.roles.find(r => { return r.name == roleName; });
	if (divisionRole)
		return message.reply("Division already exists.").catch(() => {});

	try {
		//create officers role
		divisionRole = await guild.createRole({ name: roleName, permissions: 0, mentionable: true }, `Requested by ${getNameFromMessage(message)}`);
		const memberRole = guild.roles.find(r => { return r.name == config.memberRole; });
		await divisionRole.setPosition(memberRole.position + 1).catch(e => { console.log(e); });

		//add category for division
		let permissions = getPermissionsForEveryone(guild);
		divisionCategory = await guild.createChannel(divisionName, { type: 'category', name: divisionName, permissionOverwrites: permissions, reason: `Requested by ${getNameFromMessage(message)}` })
			.catch(e => { console.log(e); });

		//create members channel
		permissions = addRoleToPermissions(guild, divisionRole, getPermissionsForMembers(guild), ['VIEW_CHANNEL', 'CONNECT', 'MANAGE_MESSAGES']);
		let membersChannel = await guild.createChannel(divisionMembersChannel, { type: 'text', name: divisionMembersChannel, parent: divisionCategory, permissionOverwrites: permissions, reason: `Requested by ${getNameFromMessage(message)}` })
			.catch(e => { console.log(e); });

		//create officers channel
		permissions = addRoleToPermissions(guild, divisionRole, getPermissionsForModerators(guild), ['VIEW_CHANNEL', 'CONNECT', 'MANAGE_MESSAGES']);
		let officersChannel = await guild.createChannel(divisionOfficersChannel, { type: 'text', name: divisionOfficersChannel, parent: divisionCategory, permissionOverwrites: permissions, reason: `Requested by ${getNameFromMessage(message)}` })
			.catch(e => { console.log(e); });

		//create public channel
		permissions = addRoleToPermissions(guild, divisionRole, getPermissionsForEveryone(guild), ['VIEW_CHANNEL', 'CONNECT', 'MANAGE_MESSAGES']);
		let publicChannel = await guild.createChannel(divisionPublicChannel, { type: 'text', name: divisionPublicChannel, parent: divisionCategory, permissionOverwrites: permissions, reason: `Requested by ${getNameFromMessage(message)}` })
			.catch(e => { console.log(e); });

		//create member voice channel
		permissions = addRoleToPermissions(guild, divisionRole, getPermissionsForMembers(guild), ['VIEW_CHANNEL', 'CONNECT', 'MANAGE_MESSAGES']);
		let memberVoipChannel = await guild.createChannel(divisionMemberVoiceChannel, { type: 'voice', name: divisionMemberVoiceChannel, parent: divisionCategory, permissionOverwrites: permissions, reason: `Requested by ${getNameFromMessage(message)}` })
			.catch(e => { console.log(e); });

		return message.reply(`${divisionName} division added`).catch(() => {});
	} catch (error) {
		notifyRequestError(error, message, (perm >= PERM_MOD));
		return message.reply(`Failed to add ${divisionName} division`).catch(() => {});
	}
}

//remdivision command processing
async function commandRemDivision(message, cmd, args, guild, perm, permName, isDM) {
	let divisionName = args.join(' ');
	if (divisionName === undefined || divisionName == '')
		return message.reply("A name must be provided");
	let roleName = divisionName + ' ' + config.discordOfficerSuffix;

	const divisionCategory = guild.channels.find(c => { return (c.name == divisionName && c.type === 'category'); });
	if (divisionCategory) {
		if (config.protectedCategories.includes(divisionCategory.name))
			return message.reply(`${divisionName} is a protected category.`);

		//remove channels in category
		for (var c of divisionCategory.children.values()) {
			try {
				await c.setParent(null, `Requested by ${getNameFromMessage(message)}`);
				await c.delete(`Requested by ${getNameFromMessage(message)}`);
			} catch (error) {
				notifyRequestError(error, message, (perm >= PERM_MOD));
			}
		}

		//remove category
		try {
			await divisionCategory.delete(`Requested by ${getNameFromMessage(message)}`);
		} catch (error) {
			notifyRequestError(error, message, (perm >= PERM_MOD));
		}

		//remove role
		const role = guild.roles.find(r => { return r.name == roleName; });
		if (role) {
			try {
				await role.delete(`Requested by ${getNameFromMessage(message)}`);
			} catch (error) {
				notifyRequestError(error, message, (perm >= PERM_MOD));
			}
		}

		if (forumIntegrationConfig[roleName] !== undefined) {
			delete(forumIntegrationConfig[roleName]);
			fs.writeFileSync(config.forumGroupConfig, JSON.stringify(forumIntegrationConfig), 'utf8');
			getRolesByForumGroup(guild, true);
		}
		return message.reply(`${divisionName} division removed`);
	} else {
		return message.reply(`${divisionName} division not found`);
	}
}

//sub/unsub/list command processing
function commandSub(message, cmd, args, guild, perm, permName, isDM) {
	let rolesConfig;
	let member = message.mentions.users.first();
	let assign = false;
	if (member) {
		if (perm < PERM_MOD) {
			return message.reply("You don't have permissions assign roles.");
		}
		if (args.length > 0)
			args.shift();
		member = guild.members.get(member.id);
		rolesConfig = assignableRoles;
		assign = true;
	} else {
		rolesConfig = subscribableRoles;
		member = message.member;
	}

	switch (cmd) {
		case 'sub':
		case 'unsub': {
			if (args.length <= 0)
				return message.reply('Role must be provided');
			let roleName = args.join(' ');
			if (rolesConfig[roleName] === undefined) {
				if (assign)
					return message.reply(`Role ${roleName} is not assignable`);
				else
					return message.reply(`Role ${roleName} is not subscribable`);
			}
			return addRemoveRole(message, guild, cmd === 'sub', rolesConfig[roleName].roleID, true, member);
		}
		case 'list': {
			let subedRoles = [];
			let availRoles = [];
			for (var roleName in rolesConfig) {
				if (rolesConfig.hasOwnProperty(roleName)) {
					if (member.roles.get(rolesConfig[roleName].roleID))
						subedRoles.push(roleName);
					else
						availRoles.push(roleName);
				}
			}
			subedRoles.sort();
			availRoles.sort();
			if (assign)
				return message.reply({
					embed: {
						title: 'Assigned Roles',
						fields: [
							{ name: 'Assigned Roles', value: subedRoles.length ? subedRoles.join("\n") : '*No Roles Assigned*' },
							{ name: 'Available Roles', value: availRoles.length ? availRoles.join("\n") : '*No Roles Available*' },
						]
					}
				});
			else
				return message.reply({
					embed: {
						title: 'Role Subscriptions',
						fields: [
							{ name: 'Subscribed Roles', value: subedRoles.length ? subedRoles.join("\n") : '*No Roles Subscribed*' },
							{ name: 'Available Roles', value: availRoles.length ? availRoles.join("\n") : '*No Roles Available*' },
						]
					}
				});
		}
	}
}

//subrole command processing
function commandSubRoles(message, cmd, args, guild, perm, permName, isDM) {
	if (args.length <= 0)
		return message.reply('No parameters provided');

	let subcmd = args.shift();
	switch (subcmd) {
		case 'adda':
		case 'add': {
			let rolesConfig;
			let rolesConfigFile;
			if (subcmd === 'adda') {
				rolesConfig = assignableRoles;
				rolesConfigFile = config.assignableRoles;
			} else {
				rolesConfig = subscribableRoles;
				rolesConfigFile = config.subscribableRoles;
			}

			if (args.length <= 0)
				return message.reply('Role must be provided');

			let roleName = args.join(' ');
			const role = guild.roles.find(r => { return r.name == roleName; });
			if (!role)
				return message.reply(`Role ${roleName} not found`);

			if (rolesConfig[roleName] === undefined) {
				rolesConfig[roleName] = {
					roleID: role.id
				};
			} else {
				if (rolesConfig[roleName].roleID !== role.id)
					return message.reply(`Role ${roleName} already managed, but ID is different`);
				else
					return message.reply(`Role ${roleName} already managed`);
			}

			fs.writeFileSync(rolesConfigFile, JSON.stringify(rolesConfig), 'utf8');
			return message.reply(`Role ${roleName} added to subscribable roles`);
		}
		case 'rema':
		case 'rem': {
			let rolesConfig;
			let rolesConfigFile;
			if (subcmd === 'rema') {
				rolesConfig = assignableRoles;
				rolesConfigFile = config.assignableRoles;
			} else {
				rolesConfig = subscribableRoles;
				rolesConfigFile = config.subscribableRoles;
			}

			if (args.length <= 0)
				return message.reply('Role must be provided');

			let roleName = args.join(' ');
			if (rolesConfig[roleName] === undefined) {
				return message.reply(`Role ${roleName} not managed`);
			} else {
				delete rolesConfig[roleName];
			}

			fs.writeFileSync(rolesConfigFile, JSON.stringify(rolesConfig), 'utf8');
			return message.reply(`Role ${roleName} removed from subscribable roles`);
		}
		case 'list': {
			let subRoles = [];
			let assignRoles = [];
			let roleName;
			for (roleName in subscribableRoles) {
				if (subscribableRoles.hasOwnProperty(roleName)) {
					subRoles.push(roleName);
				}
			}
			for (roleName in assignableRoles) {
				if (assignableRoles.hasOwnProperty(roleName)) {
					assignRoles.push(roleName);
				}
			}
			subRoles.sort();
			assignRoles.sort();
			return message.reply({
				embed: {
					fields: [
						{ name: "Subscribable Roles", value: subRoles.length ? subRoles.join("\n") : '*No roles configuerd*' },
						{ name: "Assignable Roles", value: assignRoles.length ? assignRoles.join("\n") : '*No roles configuerd*' }
					]
				}
			});
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

function commandShowWebhooks(message, cmd, args, guild, perm, permName, isDM)
{
	if (!message.member)
		return;
	getWebhooksForGuild(guild)
		.then(hooks=>{
			var embed = {title: 'Current Webhooks', fields: []};
			for(i in hooks)
			{
				let hook = hooks[i];
				let channel = guild.channels.get(hook.channel_id);
				let channelname = channel?channel.name:hook.channel_id;
				embed.fields.push({
					name: `${hook.name} (Channel: ${channelname})`,
					value: `${hook.id}/${hook.token}`
				});
			}
			message.member.send({embed: embed});
		})
		.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD));});
}*/

function commandMute(message, cmd, args, guild, perm, permName, isDM) {
	let member = getMemberFromMessageOrArgs(guild, message, args);
	if (!member)
		return message.reply("Please mention a valid member of this server");
	var [memberPerm, memberPermName] = getPermissionLevelForMember(member);
	if (perm <= memberPerm)
		return message.reply(`You cannot mute ${member.user.tag}.`);

	return addRemoveRole(message, guild, cmd === 'mute', config.muteRole, false, member);
}

function commandPTT(message, cmd, args, guild, perm, permName, isDM) {
	let member = getMemberFromMessageOrArgs(guild, message, args);
	if (!member)
		return message.reply("Please mention a valid member of this server");
	var [memberPerm, memberPermName] = getPermissionLevelForMember(member);
	if (perm <= memberPerm)
		return message.reply(`You cannot make ${member.user.tag} PTT.`);

	return addRemoveRole(message, guild, cmd === 'setptt', config.pttRole, false, member);
}

//kick command processing
function commandKick(message, cmd, args, guild, perm, permName, isDM) {
	let member = getMemberFromMessageOrArgs(guild, message, args);
	if (!member)
		return message.reply("Please mention a valid member of this server");
	if (!member.kickable)
		return message.reply(`I cannot kick ${member.user.tag}.`);
	var [memberPerm, memberPermName] = getPermissionLevelForMember(member);
	if (perm <= memberPerm)
		return message.reply(`You cannot kick ${member.user.tag}.`);

	args.shift(); //trim mention
	let reason = args.join(' ');
	if (!reason || reason == '') reason = "No reason provided";

	member.kick(`Requested by ${getNameFromMessage(message)}: ${reason}`)
		.catch(error => message.reply(`Sorry ${message.author} I couldn't kick because of : ${error}`));
	message.reply(`${member.user.tag} has been kicked by ${message.author.tag} because: ${reason}`);
}

//ban command processing
function commandBan(message, cmd, args, guild, perm, permName, isDM) {
	let toBan = getMemberFromMessageOrArgs(guild, message, args);
	let tag;
	if (toBan) {
		if (!toBan.bannable)
			return message.reply(`I cannot ban ${toBan.user.tag}.`);
		var [memberPerm, memberPermName] = getPermissionLevelForMember(toBan);
		if (perm <= memberPerm)
			return message.reply(`You cannot ban ${toBan.user.tag}.`);
		tag = toBan.user.tag;
	} else {
		toBan = message.mentions.users.first();
		if (!toBan)
			return message.reply("Please mention a valid member of this server");
		tag = toBan.tag;
	}

	args.shift(); //trim mention
	let reason = args.join(' ');
	if (!reason || reason == '') reason = "No reason provided";

	guild.ban(toBan)
		.catch(error => message.reply(`Sorry ${message.author} I couldn't ban because of : ${error}`));
	message.reply(`${tag} has been banned by ${message.author.tag} because: ${reason}`);
}

//tracker command processing
function commandTracker(message, cmd, args, guild, perm, permName, isDM) {
	var postOptions = {
		method: 'POST',
		url: config.trackerURL,
		headers: {
			'User-Agent': 'Discord Bot'
		},
		form: {
			type: 'discord',
			text: args.join(' '),
			token: config.trackerToken
		},
		json: true
	};
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
	request(postOptions, function(error, response, body) {
		if (error)
			return message.reply('There was an error processing the request');

		if (body.embed)
			return message.reply({ embed: body.embed });
		else if (body.text)
			return message.reply(body.text);
		return message.reply('There was an error processing the request');
	});
}

//get forum groups from forum database
function getForumGroups() {
	var promise = new Promise(function(resolve, reject) {
		let db = connectToDB();
		let query = `SELECT usergroupid AS id,title AS name FROM ${config.mysql.prefix}usergroup`; //WHERE title LIKE "AOD%" OR title LIKE "%Officers"
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

var unicodeRegEx = /&#([0-9]+);/g; //BE CAREFUL OF CAPTURE GROUPS BELOW
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
	return entities.decode(discordName);
}

//get forum users from forum groups
function getForumUsersForGroups(groups) {
	var promise = new Promise(function(resolve, reject) {
		let db = connectToDB();
		let groupStr = groups.join(',');
		let groupRegex = groups.join('|');
		let query =
			`SELECT u.userid,u.username,f.field19,f.field20,f.field13 FROM ${config.mysql.prefix}user AS u ` +
			`INNER JOIN ${config.mysql.prefix}userfield AS f ON u.userid=f.userid ` +
			`WHERE (u.usergroupid IN (${groupStr}) OR u.membergroupids REGEXP '(^|,)(${groupRegex})(,|$)') ` +
			`AND ((f.field19 IS NOT NULL AND f.field19 <> '') OR (f.field20 IS NOT NULL AND f.field20 <> '')) ` +
			`ORDER BY f.field13,u.username`;
		db.query(query, function(err, rows, fields) {
			if (err)
				return reject(err);
			else {
				let usersByIDOrDiscriminator = {};
				for (var i in rows) {
					let discordid = rows[i].field20;
					let discordtag = convertForumDiscordName(rows[i].field19);
					let index = ((discordid && discordid != '') ? discordid : discordtag);

					if (usersByIDOrDiscriminator[index] !== undefined) {
						console.log(`Found duplicate tag ${usersByIDOrDiscriminator[index].discordtag} for forum user ${rows[i].username} first seen for forum user ${usersByIDOrDiscriminator[index].name}`);
					} else {
						usersByIDOrDiscriminator[index] = {
							name: rows[i].username,
							id: rows[i].userid,
							division: rows[i].field13,
							discordid: discordid,
							discordtag: discordtag
						};
					}
				}
				return resolve(usersByIDOrDiscriminator);
			}
		});
	});
	return promise;
}

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
	let db = connectToDB();
	let tag = db.escape(convertDiscordTag(guildMember.user.tag));
	let query = `UPDATE ${config.mysql.prefix}userfield SET field20="${guildMember.user.id}" WHERE userid=${forumUser.id}`;
	db.query(query, function(err, rows, fields) {});
}

function setDiscordTagForForumUser(forumUser, guildMember) {
	if (forumUser.discordtag == guildMember.user.tag)
		return;
	console.log(`Updating Discord Tag for ${forumUser.name} (${forumUser.id}) Discord ID ${guildMember.user.id} from '${forumUser.discordtag}' to '${guildMember.user.tag}'`);
	let db = connectToDB();
	let tag = db.escape(convertDiscordTag(guildMember.user.tag));
	let query = `UPDATE ${config.mysql.prefix}userfield SET field19=${tag} WHERE field20="${guildMember.user.id}" AND userid=${forumUser.id}`;
	db.query(query, function(err, rows, fields) {});
	forumUser.discordtag = guildMember.user.tag;
}

//do forum sync with discord roles
async function doForumSync(message, guild, perm, checkOnly, doDaily) {
	var hrStart = process.hrtime();
	const guestRole = guild.roles.find(r => { return r.name == config.guestRole; });
	const memberRole = guild.roles.find(r => { return r.name == config.memberRole; });
	const sgtsChannel = guild.channels.find(c => { return c.name === 'aod-sergeants'; });
	const reason = (message ? `Requested by ${getNameFromMessage(message)}` : 'Periodic Sync');
	let adds = 0,
		removes = 0,
		renames = 0,
		misses = 0,
		duplicates = 0;

	let nickNameChanges = {};
	let forumGroups;
	try {
		forumGroups = await getForumGroups();
	} catch (error) {
		return notifyRequestError(error, message, (perm >= PERM_MOD));
	}

	let date = new Date();
	try {
		fs.writeFileSync(config.syncLogFile, `${date.toISOString()}  Forum sync started\n`, 'utf8');
	} catch (e) {
		console.error(e);
	}

	var online = 0,
		offline = 0,
		idle = 0,
		dnd = 0,
		total = 0;
	guild.members.forEach(function(m) {
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
		total++;
	});
	try {
		fs.writeFileSync(config.populationLogFile, `${online}/${idle}/${dnd}/${total}\n`, 'utf8');
	} catch (e) {
		console.error(e);
	}

	var seenByID = {}; //make sure we don't have users added as both guest and member
	for (var roleName in forumIntegrationConfig) {
		if (forumIntegrationConfig.hasOwnProperty(roleName)) {
			var groupMap = forumIntegrationConfig[roleName];

			var role;
			if (groupMap.roleID === undefined) {
				//make sure we actually have the roleID in our structure
				role = guild.roles.find(r => { return r.name == roleName; });
				if (role)
					groupMap.roleID = role.id;
			} else
				role = guild.roles.get(groupMap.roleID);

			if (role) {
				let usersByIDOrDiscriminator;
				try {
					usersByIDOrDiscriminator = await getForumUsersForGroups(groupMap.forumGroups);
				} catch (error) {
					notifyRequestError(error, message, (perm >= PERM_MOD));
					continue;
				}

				date = new Date();
				fs.appendFileSync(config.syncLogFile, `${date.toISOString()}  Sync ${role.name}\n`, 'utf8');
				let embed = {
					title: `Sync ${role.name}`,
					fields: []
				};

				//for each guild member with the role
				//   track them by tag so we can easily access them again later
				//   if their tags aren't configured on the forums, mark for removal
				//   make sure anyone remaining has a valid nickname
				var toRemove = [];
				var toUpdate = [];
				var membersByID = {};
				var duplicateTag = [];
				for (var roleMember of role.members.values()) {
					membersByID[roleMember.user.id] = roleMember;
					let forumUser = usersByIDOrDiscriminator[roleMember.user.id];
					if (forumUser === undefined) {
						forumUser = usersByIDOrDiscriminator[roleMember.user.tag];
						if (forumUser !== undefined) {
							usersByIDOrDiscriminator[roleMember.user.id] = forumUser;
							delete usersByIDOrDiscriminator[roleMember.user.tag];
							setDiscordIDForForumUser(forumUser, roleMember);
						}
					}

					if (forumUser === undefined) {
						if (role.id !== guestRole.id) {
							if (role.id !== guestRole.id) {
								removes++;
								toRemove.push(`${roleMember.user.tag} (${roleMember.displayName})`);
							}
							if (!checkOnly) {
								try {
									await roleMember.removeRole(role, reason);
									if (role.name === config.memberRole) {
										//we're removing them from AOD, clear the name set from the forums
										await roleMember.setNickname('', reason);
										//Members shouldn't have been guests... lest there be a strange permission thing when AOD members are removed
										if (roleMember.roles.get(guestRole.id))
											await roleMember.removeRole(guestRole);
									}
								} catch (error) {
									console.error(`Failed to remove ${role.name} from ${roleMember.user.tag}`);
									notifyRequestError(error, message, (perm >= PERM_MOD));
								}
							}
						}
					} else {
						if (nickNameChanges[roleMember.user.id] === undefined && roleMember.displayName !== forumUser.name) {
							nickNameChanges[roleMember.user.id] = true;
							if (role.id !== guestRole.id) {
								renames++;
								toUpdate.push(`${roleMember.user.tag} (${roleMember.displayName} ==> ${forumUser.name})`);
							}
							if (!checkOnly) {
								try {
									await roleMember.setNickname(forumUser.name, reason);
								} catch (error) {
									notifyRequestError(error, message, (perm >= PERM_MOD));
									continue;
								}
							}
						}
						if (forumUser.discordtag != roleMember.user.tag)
							setDiscordTagForForumUser(forumUser, roleMember);

						//Members shouldn't also be guests... lest there be a strange permission thing when AOD members are removed
						if (role.id === memberRole.id) {
							if (seenByID[roleMember.id] !== undefined) {
								duplicateTag.push(`${roleMember.user.tag} (${forumUser.name}) -- First seen user ${seenByID[roleMember.id].name}`);
								duplicates++;
							} else {
								seenByID[roleMember.id] = forumUser;
							}
							if (!checkOnly) {
								if (roleMember.roles.get(guestRole.id)) {
									try {
										await roleMember.removeRole(guestRole);
									} catch (error) {
										notifyRequestError(error, message, (perm >= PERM_MOD));
										continue;
									}
								}
							}
						} else if (role.id === guestRole.id) {
							if (seenByID[roleMember.id] !== undefined) {
								duplicateTag.push(`${roleMember.user.tag} (${forumUser.name}) -- First seen user ${seenByID[roleMember.id].name}`);
								duplicates++;
							} else {
								seenByID[roleMember.id] = forumUser;
							}
							if (!checkOnly) {
								if (roleMember.roles.get(memberRole.id)) {
									try {
										await roleMember.removeRole(memberRole);
									} catch (error) {
										notifyRequestError(error, message, (perm >= PERM_MOD));
										continue;
									}
								}
							}
						}
					}
				}

				//for each forum member mapped to the role
				//   if we haven't already seen the guild member
				//       if there is a guild member record, at them to the role and make sure the nickname is valid
				//       otherwise, mark them as an error and move on
				var toAdd = [];
				var noAccount = [];
				for (var u in usersByIDOrDiscriminator) {
					if (usersByIDOrDiscriminator.hasOwnProperty(u)) {
						if (membersByID[u] === undefined) {
							let forumUser = usersByIDOrDiscriminator[u];
							let guildMember = guild.members.get(u);
							if (guildMember === undefined) {
								guildMember = guild.members.find(m => { return m.user.tag === u; });
								if (guildMember) {
									delete usersByIDOrDiscriminator[u]; //don't add the ID to the list, we're done processing
									setDiscordIDForForumUser(forumUser, guildMember);
								}
							}
							if (guildMember) {
								if (role.id !== guestRole.id) {
									adds++;
									toAdd.push(`${guildMember.user.tag} (${forumUser.name})`);
								}
								if (!checkOnly) {
									try {
										await guildMember.addRole(role, reason);
									} catch (error) {
										console.error(`Failed to add ${role.name} to ${guildMember.user.tag}`);
										notifyRequestError(error, message, (perm >= PERM_MOD));
										continue;
									}
								}
								if (nickNameChanges[guildMember.user.id] === undefined && guildMember.displayName !== forumUser.name) {
									nickNameChanges[guildMember.user.id] = true;
									if (role.id !== guestRole.id) {
										renames++;
										toUpdate.push(`${guildMember.user.tag} (${guildMember.displayName} ==> ${forumUser.name})`);
									}
									if (!checkOnly) {
										try {
											await guildMember.setNickname(forumUser.name, reason);
										} catch (error) {
											console.error(`Failed to rename ${guildMember.user.tag} to ${forumUser.name}`);
											notifyRequestError(error, message, (perm >= PERM_MOD));
											continue;
										}
									}
								}
								if (forumUser.discordtag != guildMember.user.tag)
									setDiscordTagForForumUser(forumUser, guildMember);
							} else {
								if (role.id !== guestRole.id) {
									misses++;
									noAccount.push(`${u} (${forumUser.name} -- ${forumUser.division})`);
								}
							}
						}
					}
				}

				if (role.id !== guestRole.id) {
					var sendMessage = false;
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
						sendReplyToMessageAuthor(message, { embed: embed }).catch(() => {});
					}
				}
			}
		}
	}

	if (doDaily === true && misses > 0) {
		if (sgtsChannel) {
			sgtsChannel.send(`The forum sync process found ${misses} members with no discord account and ${duplicates} duplicate tags. Please check https://www.clanaod.net/forums/aodinfo.php?type=last_discord_sync for the last sync status.`).catch(() => {});
		}
	}

	let hrEnd = process.hrtime(hrStart);
	let msg = `Forum Sync Processing Time: ${hrEnd[0] + (Math.round(hrEnd[1]/1000000)/1000)}s; ${adds} roles added, ${removes} roles removed, ${renames} members renamed, ${misses} members with no discord account, ${duplicates} duplicate tags`;
	if (message)
		sendReplyToMessageAuthor(message, msg).catch(() => {});
	if (message || adds || removes || renames)
		console.log(msg);
	date = new Date();
	fs.appendFileSync(config.syncLogFile, `${date.toISOString()}  ${msg}\n`, 'utf8');
}

//forum sync command processing
function commandForumSync(message, cmd, args, guild, perm, permName, isDM) {
	let subCmd = args.shift();
	if (!subCmd)
		return;

	switch (subCmd) {
		case 'showmap': {
			getForumGroups()
				.then(forumGroups => {
					let embed = {
						title: 'Configured Group Maps',
						fields: []
					};

					Object.keys(forumIntegrationConfig).forEach(roleName => {
						var groupMap = forumIntegrationConfig[roleName];
						embed.fields.push({
							name: roleName + (groupMap.permanent ? ' (permanent)' : ''),
							value: groupMap.forumGroups.map(groupID => `${forumGroups[groupID]} (${groupID})`).join(', ')
						});

						if (embed.fields.length >= 25) {
							sendReplyToMessageAuthor(message, { embed: embed });
							embed.fields = [];
						}
					});

					sendReplyToMessageAuthor(message, { embed: embed });
				})
				.catch(error => { notifyRequestError(error, message, (perm >= PERM_MOD)); });
			break;
		}
		case 'showroles': {
			let embed = {
				title: '',
				fields: [{
					name: 'Discord Officer Roles',
					value: guild.roles.array().filter(r => r.name.endsWith(config.discordOfficerSuffix)).map(r => r.name).sort().join("\n")
				}]
			};
			sendReplyToMessageAuthor(message, { embed: embed });
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
						sendReplyToMessageAuthor(message, { embed: embed });
					}
				})
				.catch(error => { notifyRequestError(error, message, (perm >= PERM_MOD)); });
			break;
		}
		case 'check':
			doForumSync(message, guild, perm, true);
			break;
		case 'sync':
			doForumSync(message, guild, perm, false);
			break;
		case 'add': {
			let roleName = args.shift();
			let groupName = args.shift();

			if (!roleName.endsWith(config.discordOfficerSuffix))
				return message.reply('Only Officer Roles may be mapped');
			if (!groupName.endsWith(config.forumOfficerSuffix))
				return message.reply('Only Officer Groups may be mapped');

			const role = guild.roles.find(r => { return r.name == roleName; });
			if (!role)
				return message.reply(`${roleName} role not found`);
			let map = forumIntegrationConfig[role.name];
			if (map && map.permanent)
				return message.reply(`${roleName} can not be edited`);

			getForumGroups()
				.then(forumGroups => {
					var forumGroupId = parseInt(Object.keys(forumGroups).find(k => {
						if (forumGroups[k] !== groupName)
							return false;
						return true;
					}), 10);
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
							return message.reply(`Mapped group ${groupName} to role ${role.name}`);
						} else {
							let index = map.forumGroups.indexOf(forumGroupId);
							if (index < 0) {
								map.forumGroups.push(forumGroupId);
								fs.writeFileSync(config.forumGroupConfig, JSON.stringify(forumIntegrationConfig), 'utf8');
								getRolesByForumGroup(guild, true);
								return message.reply(`Mapped group ${groupName} to role ${role.name}`);
							} else {
								return message.reply('Map already exists');
							}
						}
					} else {
						return message.reply(`${groupName} group not found`);
					}
				})
				.catch(error => { notifyRequestError(error, message, (perm >= PERM_MOD)); });
			break;
		}
		case 'rem': {
			let roleName = args.shift();
			let groupName = args.shift();

			if (!roleName.endsWith(config.discordOfficerSuffix))
				return message.reply('Only Officer Roles may be mapped');
			if (!groupName.endsWith(config.forumOfficerSuffix))
				return message.reply('Only Officer Groups may be mapped');

			const role = guild.roles.find(r => { return r.name == roleName; });
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
				.catch(error => { notifyRequestError(error, message, (perm >= PERM_MOD)); });
		}
	}
}

//function to send a message to a change that always returns a promise (simplifies exception handling)
function sendMessageToChannel(channel, content) {
	let json;
	try { json = JSON.parse(content); } catch (e) {}

	if (json !== undefined) {
		if (json.embed)
			return channel.send({ embed: json.embed });
		else if (json.text)
			return channel.send(json.text);
	} else
		return channel.send(content);
}

//relay command processing
function commandRelay(message, cmd, args, guild, perm, permName, isDM) {
	if (isDM)
		return;
	if (args.length <= 0)
		return;

	let channelName = args[0].toLowerCase();
	let channel = guild.channels.find(c => { return (c.name.toLowerCase() == channelName); });
	if (channel)
		args.shift();
	else
		channel = message.channel;

	if (channel.type !== 'text')
		return;

	let content = args.join(' ');
	if (!content || content === '')
		return;

	sendMessageToChannel(channel, content)
		.finally(() => { message.delete(); })
		.catch(error => { notifyRequestError(error, null, PERM_NONE); });
}

function commandRelayDm(message, cmd, args, guild, perm, permName, isDM) {
	if (args.length <= 0)
		return;
	let member = getMemberFromMessageOrArgs(guild, message, args);
	if (!member)
		return;
	args.shift();

	let content = args.join(' ');
	if (!content || content === '')
		return;

	sendMessageToMember(member, content)
		.catch(error => { notifyRequestError(error, null, PERM_NONE); });
}

//admin command processing
function commandSetAdmin(message, cmd, args, guild, perm, permName, isDM) {
	addRemoveRole(message, guild, cmd === 'addadmin', 'Admin', false, getMemberFromMessageOrArgs(guild, message, args));
}

//reload command processing
function commandReload(message, cmd, args, guild, perm, permName, isDM) {
	console.log(`Reload config requested by ${getNameFromMessage(message)}`);
	config = require('./aod-discord-bot.config.json');
	message.reply('Configuration reloaded');
}

//status command processing
function commandStatus(message, cmd, args, guild, perm, permName, isDM) {
	let uptimeSeconds = Math.round(client.uptime / 1000);
	let uptimeMinutes = Math.floor(uptimeSeconds / 60);
	uptimeSeconds -= (uptimeMinutes * 60);
	let uptimeHours = Math.floor(uptimeMinutes / 60);
	uptimeMinutes -= (uptimeHours * 60);
	let uptimeDays = Math.floor(uptimeHours / 24);
	uptimeHours -= (uptimeDays * 24);

	let lastForumSyncDiff = new Date(new Date() - lastForumSync);

	let embed = {
		title: 'Bot Status',
		fields: [
			{ name: 'UpTime', value: `${uptimeDays} days, ${uptimeHours} hours, ${uptimeMinutes} minutes, ${uptimeSeconds} seconds` },
			{ name: 'Server Status', value: `${guild.name} has ${guild.members.size} members and ${guild.channels.size} channels` },
			{ name: 'Server Region', value: `${guild.region}` },
			{ name: 'Last Forum Sync', value: `${lastForumSyncDiff.getMinutes()} minutes, ${lastForumSyncDiff.getSeconds()} seconds ago` },
			{ name: 'Average WebSocket Hearbeat Time', value: `${client.ping}ms for ${client.pings.length} pings` },
		]
	};

	message.reply({ embed: embed });
}

//quit command processing
function commandQuit(message, cmd, args, guild, perm, permName, isDM) {
	console.log(`Bot quit requested by ${getNameFromMessage(message)}`);
	client.destroy();
	process.exit();
}

async function commandTest(message, cmd, args, guild, perm, permName, isDM) {
	var reply = "";

	message.reply(`"${args.join('" "')}"`);

	/*
	guild.channels.forEach(async function (c){
		if (c.type == 'voice' && c.name.indexOf('temp') >= 0)
		{
			reply += `deleted ${c.parent.name} ${c.name}\n`;
			await c.delete().catch(()=>{});
		}
	});
	message.reply(reply);
	*/

	/*
	reply = "";
	guild.roles.forEach(async function (r){
		if (r.name.indexOf('Officer') >= 0)
		{
			var category = r.name.replace(" Officer", "");
			const channelCategory = guild.channels.find(c=>{return c.name == category && c.type=='category';});
			if (channelCategory)
			{
				reply += channelCategory.name + "\n";
				
				let channelName = category.toLowerCase().replace(/\s/g, '-');
				channelName += "-member-voip"
				
				var defaultDeny = ['VIEW_CHANNEL','CONNECT'];
				var permissions = getPermissionsForMembers(guild, [], defaultDeny);
				//add role permissions if necessary
				permissions = addRoleToPermissions(guild, r, permissions, ['VIEW_CHANNEL','CONNECT','MANAGE_MESSAGES']);
				
				await guild.createChannel(channelName, {type: 'voice', name: channelName, parent: channelCategory, permissionOverwrites: permissions, bitrate: 96000, reason: "Recreating backup voip"}).catch(e=>{console.log(e)});
			}
		}
	});
	message.reply(reply);
	*/

	/*
	const memberRole = guild.roles.find(r=>{return r.name == config.memberRole;});
	var db = connectToDB();
	memberRole.members.forEach(m => {
		let query = 		
			`UPDATE ${config.mysql.prefix}userfield ` +
			`SET field20 = "${m.user.id}" ` +
			`WHERE field19 LIKE "${convertDiscordTag(m.user.tag)}"`;
		console.log(query);
		db.query(query, function(err, rows, fields) {
			if (err)
				console.log(err);
		});
	});
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
	},
	*/
	help: {
		minPermission: PERM_NONE,
		args: "[<command>]",
		helpText: "Displays the help menu. If <command> is present, only that command will be shown.",
		callback: commandHelp
	},
	login: {
		minPermission: PERM_NONE,
		args: ["\"<username|email>\"", "\"<password>\""],
		helpText: "Associate discord user to AOD forum account.\nWARNING: This command may only be used in a DM to the discord bot.",
		callback: commandLogin,
		dmOnly: true
	},
	ping: {
		minPermission: PERM_GUEST,
		args: "",
		helpText: "Returns a DM letting you know the bot is alive. Staff and Moderators will get an estimate of network latency.",
		callback: commandPing
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
		args: ["[<category>]", "[<guest|member|officer|mod|staff|admin>]", "<name>"],
		helpText: ["Creates a temporary voice channel visible to Members+ by default.\nIf <category> is provided, the channel will be permanent in that cateogry (requires staff permissions).",
			"*guest*: channel is visible to Guest+ (requires Moderator permissions)",
			"*member*: channel is visible to Moderator+ (requires Officer permissions)",
			"*officer*: channel is visible to Moderator+ (requires Moderator permissions)",
			"*mod*: channel is visible to Moderator+ (requires Moderator permissions)",
			"*staff*: channel is visible to Staff+ (requires Staff permissions)",
			"*admin*: channel is visible to Admins (requires Admin permissions)"],
		callback: commandAddChannel
	},
	ptt: {
		minPermission: PERM_RECRUITER,
		args: ["[<category>]", "[<guest|member|officer|mod|staff|admin>]", "<name>"],
		helpText: ["Creates a temporary push-to-talk channel visible to Members+ by default.\nIf <category> is provided, the channel will be permanent in that cateogry (requires staff permissions).",
			"*guest*: channel is visible to Guest+ (requires Moderator permissions)",
			"*member*: channel is visible to Moderator+ (requires Officer permissions)",
			"*officer*: channel is visible to Moderator+ (requires Moderator permissions)",
			"*mod*: channel is visible to Moderator+ (requires Moderator permissions)",
			"*staff*: channel is visible to Staff+ (requires Staff permissions)",
			"*admin*: channel is visible to Admins (requires Admin permissions)"],
		callback: commandAddChannel
	},
	text: {
		minPermission: PERM_DIVISION_COMMANDER,
		args: ["<category>", "[<feed|guest|member|officer|mod|staff|admin>]", "<name>"],
		helpText: ["Creates a text channel visible to Members+ by default.",
			"*feed*: channel is visible to Guest+, but only Officer+ may send messages (requires Divivion Commander permissions)",
			"*guest*: channel is visible to Guest+ (requires Moderator permissions)",
			"*member*: channel is visible to Moderator+ (requires Officer permissions)",
			"*officer*: channel is visible to Moderator+ (requires Moderator permissions)",
			"*mod*: channel is visible to Moderator+ (requires Moderator permissions)",
			"*staff*: channel is visible to Staff+ (requires Staff permissions)",
			"*admin*: channel is visible to Admins (requires Admin permissions)"],
		callback: commandAddChannel
	},
	setperms: {
		minPermission: PERM_STAFF,
		args: ["[<feed|guest|member|officer|mod|staff|admin>]", "<name>"],
		helpText: ["Updates a channels permissions.",
			"*guest*: channel is visible to Guest+ (requires Moderator permissions)",
			"*member*: channel is visible to Moderator+ (requires Officer permissions)",
			"*officer*: channel is visible to Moderator+ (requires Moderator permissions)",
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
		args: ["<add|adda|rem|rema|list>", "<name>"],
		helpText: ["Manage subscribable roles.",
			"*add*: Add a role that members can self-subscribe to",
			"*adda*: Add a role that that can be assigned",
			"*rem*: Remove a role that members can self-subscribe to",
			"*rema*: Remove a role that that can be assigned",
			"*list*: List all managed roles",
		],
		callback: commandSubRoles
	},
	purge: {
		minPermission: PERM_STAFF,
		args: "<num>",
		helpText: "Purges the last <num> messages from the channel the command was run in (1 <= num <= 100).",
		callback: commandPurge
	},
	forumsync: {
		minPermission: PERM_MOD,
		args: ["<cmd>", "[<options>]"],
		helpText: ["Forum sync integration commands:",
			"*showmap*: Shows the current synchronization map",
			"*showroles*: Shows the discord roles eligible for integration",
			"*showforumgroups*: Shows the forum groups eligible for integration",
			"*check*: Checks for exceptions between forum groups and mapped discord roles",
			"*sync*: Adds and removes members from discord roles based on forum groups",
			"*add \"<role>\" \"<group>\"*: Maps the forum <group> to the discord <role>",
			"*rem \"<role>\" \"<group>\"*: Removes the forum group from the map for the discord <role>"
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
		args: ["[\"<channel>\"]", "\"<message>\""],
		helpText: "Relay a message using the bot. If <channel> is provided, the message will be sent there.",
		callback: commandRelay
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
	quit: {
		minPermission: PERM_OWNER,
		args: "",
		helpText: "Terminate the bot",
		callback: commandQuit,
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
function processCommand(message, cmd, arg_string, guild, perm, permName, isDM) {
	var commandObj = commands[cmd];
	if (commandObj !== undefined) {
		if (commandObj.minPermission <= perm) {
			var args = getParams(arg_string);
			if (cmd == 'login')
				console.log(`${getNameFromMessage(message)} executed: ${cmd}`);
			else if (cmd !== 'help' && cmd !== 'ping')
				console.log(`${getNameFromMessage(message)} executed: ${cmd} "${args.join('" "')}"`);

			//if (commandObj.dmOnly === true && !isDM)
			//do nothing for now...

			return commandObj.callback(message, cmd, args, guild, perm, permName, isDM);
		}
	}
}


//message event handler -- triggered when client receives a message from a text channel or DM
client.on("message", message => {
	//check for prefix
	if (!message.content.startsWith(config.prefix)) return;

	//make sure we have a member
	var isDM = false;
	var guild, role, perm, permName;
	if (!message.member) {
		if (message.author.bot) {
			if (!message.webhookID || message.webhookID === '' || message.webhookID !== message.author.id)
				return; //ignore messages from bots that are not from authorized webhooks

			let webhookPerms = config.webHookPerms[message.webhookID];
			if (webhookPerms === undefined)
				return; //this bot is not allowed
			[perm, permName] = webhookPerms;

			if (message.channel && message.channel)
				guild = message.channel.guild;
			else
				guild = client.guilds.get(config.guildId);
			if (!guild)
				return; //must have guild
		} else {
			if (message.channel && message.channel.guild)
				guild = message.channel.guild;
			else
				guild = client.guilds.get(config.guildId);
			if (!guild)
				return; //must have guild

			const member = guild.member(message.author);
			if (!member)
				return; //ignore messages from any real client that isn't in the guild

			isDM = true;
			message.member = member;
			[perm, permName] = getPermissionLevelForMember(member);
		}
	} else {
		guild = message.member.guild;
		if (!guild)
			return; //must have guild
		[perm, permName] = getPermissionLevelForMember(message.member);
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
		return processCommand(message, command, arg_string, guild, perm, permName, isDM);
	} catch (error) { notifyRequestError(error, message, (perm >= PERM_MOD)); } //don't let user input crash the bot
});

//voiceStateUpdate event handler -- triggered when a user joins or leaves a channel or their status in the channel changes
client.on('voiceStateUpdate', (oldMember, newMember) => {
	//if the user left the channel, check if we should delete it
	if (oldMember.voiceChannelID != newMember.voiceChannelID) {
		if (oldMember.voiceChannel) {
			const guild = client.guilds.get(config.guildId);
			const oldCategory = guild.channels.get(oldMember.voiceChannel.parentID);
			if (oldCategory && oldCategory.name === config.tempChannelCategory) {
				if (oldMember.voiceChannel.members.size === 0) {
					oldMember.voiceChannel.delete();
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
	var promise = new Promise(function(resolve, reject) {
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
	getForumGroupsForMember(member)
		.then(async function(data) {
			if (data === undefined || data.groups.length === 0) {
				member.send(`Hello ${member.displayName}! Welcome to the ClanAOD.net Discord. Roles in our server are based on forum permissions. Use \`${config.prefix}login\` to associate your Discord user to our fourms (https://www.clanaod.net).`).catch(() => {});
				return;
			}

			let rolesByGroup = getRolesByForumGroup(member.guild);
			let rolesToAdd = [],
				existingRoles = [];
			for (var i in data.groups) {
				var group = data.groups[i];
				if (rolesByGroup[group] !== undefined) {
					Object.keys(rolesByGroup[group]).forEach(roleName => {
						let role = rolesByGroup[group][roleName];
						if (role) {
							if (!member.roles.get(role.id))
								rolesToAdd.push(role);
							else
								existingRoles.push(role);
						}
					});
				}
			}
			if (rolesToAdd.length) {
				try {
					await member.addRoles(rolesToAdd, reason);
				} catch (error) {
					return;
				}
			} else if (!existingRoles.length) {
				member.send(`Hello ${member.displayName}! Welcome to the ClanAOD.net Discord. Roles in our server are based on forum permissions. Use \`${config.prefix}login\` to associate your Discord user to our fourms (https://www.clanaod.net).`).catch(() => {});
				return;
			}

			if (member.displayName !== data.name) {
				try {
					await member.setNickname(data.name, reason);
				} catch (error) {}
			}
			let roles = existingRoles.concat(rolesToAdd);
			member.send(`Hello ${data.name}! The following roles have been granted: ${roles.map(r=>r.name).join(', ')}. Use \`!help\` to see available commands.`).catch(() => {});
		})
		.catch(error => { notifyRequestError(error, null, false); });
}

//guildMemberAdd event handler -- triggered when a user joins the guild
client.on('guildMemberAdd', member => {
	setRolesForMember(member, 'First time join');
});

/*
client.on('guildMemberUpdate', (oldMember, newMember)=>{
	if (newMember.nickname !== undefined && newMember.nickname.startsWith(config.memberPrefix)
	{
		const guild = client.guilds.get(config.guildId);
		const memberRole = guild.roles.find(r=>{return r.name == config.memberRole;});
		if (!newMember.roles.get(memberRole.id))
		{
			newMember.setNickname('');
		}
	}
});
*/

var forumSyncTimer = null;
var lastDate = null;

function forumSyncTimerCallback() {
	lastForumSync = new Date();
	let currentDate = `${lastForumSync.getFullYear()}/${lastForumSync.getMonth()+1}/${lastForumSync.getDate()}`;
	const guild = client.guilds.get(config.guildId);
	let doDaily = false;

	//console.log(`Forum sync timer called; currentDate=${currentDate} lastDate=${lastDate}`);

	if (lastDate !== null && lastDate !== currentDate)
		doDaily = true;
	lastDate = currentDate;
	doForumSync(null, guild, PERM_NONE, false, doDaily);
	if (doDaily)
		guild.pruneMembers(14, 'Forum sync timer')
		.catch(error => { notifyRequestError(error, null, false); });

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
client.on("messageDelete", (message) => {
	if (message.channel && !message.content.startsWith(config.prefix + 'relay ') && !message.content.startsWith(config.prefix + 'login '))
		console.log(`Deleted message from ${message.author.tag} in #${message.channel.name}: ${message.content}`);
});

//ready handler
client.on("ready", () => {
	console.log(`Bot has started, with ${client.users.size} users, in ${client.channels.size} channels of ${client.guilds.size} guilds.`);

	//remove any empty temp channels
	const guild = client.guilds.get(config.guildId);
	const tempChannelCategory = guild.channels.find(c => { return c.name == config.tempChannelCategory; });
	if (tempChannelCategory && tempChannelCategory.children && tempChannelCategory.children.size) {
		tempChannelCategory.children.forEach(function(c) {
			if (c.type == 'voice') {
				if (c.members.size === 0)
					c.delete();
			}
		});
	}

	forumSyncTimerCallback(); //prime the date and do initial adds
	forumSyncTimer = client.setInterval(forumSyncTimerCallback, config.forumSyncIntervalMS);

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
client.on('error', error => { notifyRequestError(error, null, false); });

//everything is defined, start the client
client.login(config.token)
	.catch(console.error);
