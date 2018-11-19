#!/bin/node
/**
 * ClanAOD.net discord integration bot
 * 
 * Author: Adam Schultz <archangel122184@gmail.com>
 */

//include discord.js
const Discord = require('discord.js');

//include request
var request = require('request');

//include config
var config = require('./aod-discord-bot.config.json');

//inclue fs
const fs = require('fs');

//include AOD group config
var forumIntegrationConfig = require(config.forumGroupConfig);

//permission levels
const PERM_OWNER = 10
const PERM_ADMIN = 9;
const PERM_STAFF = 8;
const PERM_MOD = 7;
const PERM_RECRUITER = 6;
const PERM_MEMBER = 5;
const PERM_GUEST = 1;
const PERM_NONE = 0;

//global undefined for readable code
var undefined;

//other globals
var lastTimeSync;

//initialize client
const client = new Discord.Client({
	sync: true
});

//guildCreate handler -- triggers when the bot joins a server for the first time
client.on("guildCreate", guild => {
	console.log(`New guild joined: ${guild.name} (id: ${guild.id}). This guild has ${guild.memberCount} members!`);
});

//guildCreate handler -- triggers when the bot leaves a server
client.on("guildDelete", guild => {
	console.log(`I have been removed from: ${guild.name} (id: ${guild.id})`);
});

/*************************************
	Utility Functions
 *************************************/

var rolesByForumGroup = null;
function getRolesByForumGroup(guild, doUpdate)
{
	if (!doUpdate && rolesByForumGroup !== null)
		return rolesByForumGroup;
	
	rolesByForumGroup = {};
	
	Object.keys(forumIntegrationConfig).forEach(roleName=>{
		var groupMap = forumIntegrationConfig[roleName];
		var role;
		if (groupMap.roleID === undefined)
		{
			const role = guild.roles.find(r=>{return r.name == roleName;});
			if (role)
				groupMap.roleID = role.id;
		}
		else
			role = guild.roles.get(groupMap.roleID);
		if (role)
		{
			for (var i in groupMap.forumGroups)
			{
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
function connectToDB()
{
	if (mysqlConnection !== null && mysqlConnection.state !== 'disconnected')
		return mysqlConnection;
	mysqlConnection = mysql.createConnection(config.mysql);
	mysqlConnection.connect(e=>{
		if (e)
			console.error(e);
	});
	mysqlConnection
		.on('close',e=>{
			if (e)
			{
				console.error(e);
				connectToDB();
			}
		})
		.on('error',e=>{
			console.error(e);
			if(e.code === 'PROTOCOL_CONNECTION_LOST')
				connectToDB();
		});
	return mysqlConnection;
}

//get a name to use for logging purposes
function getNameFromMessage(message)
{
	if (message)
	{
		if (message.member)
			return message.member.user.tag;
		if (message.author)
			return message.author.username;
	}
	return "<unknown>";
}

//add or remove a role from a guildMember
function addRemoveRole(message, guild, member, add, roleName)
{
	if (!guild)
		return message.reply("Invalid Guild");
	const role = guild.roles.find(r=>{return r.name == roleName;});
	if (!role)
		return message.reply("Invalid Role");
	if(!member)
		return message.reply("Please mention a valid member of this server");
	
	if (add)
		member.addRole(role, `Requested by ${getNameFromMessage(message)}`)
						.then(message.reply("Added " + role.name + " to " + member.user.tag))
						.catch(console.error);
	else
		member.removeRole(role, `Requested by ${getNameFromMessage(message)}`)
						.then(message.reply("Removed " + role.name + " from " + member.user.tag))
						.catch(console.error);
}

//map roles to permissions based on config
function getPermissionLevelForMember(member)
{
	if (member.permissions.bitfield & 0x00000008)
		return [PERM_OWNER, "Admin"];
	
	const r = member.highestRole;
	if (r) 
	{
		if (config.adminRoles.includes(r.name))
			return [PERM_ADMIN, 'Admin'];
		else if (config.staffRoles.includes(r.name))
			return [PERM_STAFF, 'Staff'];
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
function addRoleToPermissions(guild, role, permissions, allow, deny)
{
	if (!role)
		return permissions;
	
	permissions.push({
		type: 'role',
		id: role.id,
		allow: (Array.isArray(allow) ? allow : ['VIEW_CHANNEL','CONNECT']),
		deny: (Array.isArray(deny) ? deny : []),
	});

	return permissions;
}
//build a list of permissions for admin
function getPermissionsForAdmin(guild, defaultAllow, defaultDeny)
{
	let permissions = [{
		id: guild.id,
		allow: (Array.isArray(defaultAllow) ? defaultAllow : []),
		deny: (Array.isArray(defaultDeny) ? defaultDeny : ['VIEW_CHANNEL','CONNECT'])
	}];
	
	const muteRole = guild.roles.find(r=>{return r.name == config.muteRole;});
	permissions = addRoleToPermissions(guild, muteRole, permissions, [], ['SEND_MESSAGES','SEND_TTS_MESSAGES','SPEAK']);
	const pttRole = guild.roles.find(r=>{return r.name == config.pttRole;});
	permissions = addRoleToPermissions(guild, pttRole, permissions, [], ['USE_VAD']);
	
	// add admin
	config.adminRoles.forEach(n=>{
		const role = guild.roles.find(r=>{return r.name == n;});
		if (role)
			permissions = addRoleToPermissions(guild, role, permissions);
	});
	return permissions;
}
//build a list of permissions for staff+
function getPermissionsForStaff(guild, defaultAllow, defaultDeny)
{
	let permissions = getPermissionsForAdmin(guild, defaultAllow, defaultDeny);
	// add staff
	config.staffRoles.forEach(n=>{
		const role = guild.roles.find(r=>{return r.name == n;});
			permissions = addRoleToPermissions(guild, role, permissions);
	});
	return permissions;
}
//build a list of permissions for mod+
function getPermissionsForModerators(guild, defaultAllow, defaultDeny)
{
	let permissions = getPermissionsForStaff(guild, defaultAllow, defaultDeny);
	// add moderators
	config.modRoles.forEach(n=>{
		const role = guild.roles.find(r=>{return r.name == n;});
		if (role)
			permissions = addRoleToPermissions(guild, role, permissions);
	});
	return permissions;
}
//build a list of permissions for member+
function getPermissionsForMembers(guild, defaultAllow, defaultDeny)
{
	let permissions = getPermissionsForModerators(guild, defaultAllow, defaultDeny);
	const memberRole = guild.roles.find(r=>{return r.name == config.memberRole;});
	return addRoleToPermissions(guild, memberRole, permissions);
}
//build a list of permissions for guest+
function getPermissionsForEveryone(guild, defaultAllow, defaultDeny)
{
	let permissions = getPermissionsForMembers(guild, defaultAllow, defaultDeny);
	const guestRole = guild.roles.find(r=>{return r.name == config.guestRole;});
	return addRoleToPermissions(guild, guestRole, permissions);
}


/*************************************
	Command Processing Functions
 *************************************/

//forward declaration of commands in case any of the functions need it
var commands; 
 
//params parsing
var paramsRegEx = /([^\s"']+)|"(((\\")|([^"]))*)"|'(((\\')|([^']))*)'/g; //BE CAREFUL OF CAPTURE GROUPS BELOW
var paramsReplaceEscapedSingleRegEx = /\\'/g;
var paramsReplaceExcapedDoubleRegEx = /\\"/g;
function getParams(string)
{
	paramsRegEx.lastIndex = 0;
	var params = [];
	do {
		//Each call to exec returns the next regex match as an array
		var match = paramsRegEx.exec(string);
		if (match != null)
		{
			let param;
			if (match[1])
				param = match[1];
			else if (match[2])
				param = match[2].replace(paramsReplaceExcapedDoubleRegEx,'"');
			else if (match[6])
				param = match[6].replace(paramsReplaceEscapedSingleRegEx,"'");
			else
				param = match[0];
			params.push(param);
		}
	} while (match != null);
	return params;	
}

//log and notify of errors processing commands
function notifyRequestError(error, message, showError)
{
	if (!error)
		return;
	console.error(error);
	if (showError && message && message.member)
	{
		message.member.send('An error occurred while processing your request: ' + message.content + "\n" + error.toString())
			.catch(console.error);
	}
}

//send a reply as DM to the author of a message (if available) and return a promise
function sendReplyToMessageAuthor(message, data)
{
	if (message && message.member)
		return message.member.send(data);
	var promise = new Promise(function(resolve, reject)	{
		reject();
	});
	return promise;
}

//help command processing
function commandHelp(message, cmd, args, guild, perm, permName, isDM)
{
	var embed = {
		title: `User Level: **${permName}** Commands`,
		fields: [],
		footer: "**Note**: Parameters that require spaces should be 'single' or \"double\" quoted."
	}
	
	Object.keys(commands).forEach(cmd=>{
		let commandObj = commands[cmd];
		if (commandObj.minPermission <= perm)
		{
			let commandHelpText = commandObj.helpText;
			if (Array.isArray(commandHelpText))
				commandHelpText = commandHelpText.join("\n> ");
			if (commandHelpText !== '')
				embed.fields.push({
					name: `${cmd} ${commandObj.args}`,
					value: commandHelpText
				});
		}
	});
	return sendReplyToMessageAuthor(message, {'embed': embed})
		.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
}

//ping command processing
function commandPing(message, cmd, args, guild, perm, permName, isDM)
{
	if (perm >= PERM_STAFF)
		sendReplyToMessageAuthor(message, "Ping?")
			.then(m => {m.edit(`Pong! Latency is ${m.createdTimestamp - message.createdTimestamp}ms. API Latency is ${Math.round(client.ping)}ms`).catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});})
			.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
	else
		sendReplyToMessageAuthor(message, "Pong!")
			.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
}

//addaod command processing
function commandAddAOD(message, cmd, args, guild, perm, permName, isDM)
{
	if (isDM)
		return message.reply("Must be executed in a text channel");
	return addRemoveRole(message, guild, message.mentions.members.first(), true, config.memberRole);
}

//remaod command processing
function commandRemAOD(message, cmd, args, guild, perm, permName, isDM)
{
	if (isDM)
		return message.reply("Must be executed in a text channel");
	return addRemoveRole(message, guild, message.mentions.members.first(), false, config.memberRole);
}

//addguest command processing
function commandAddGuest(message, cmd, args, guild, perm, permName, isDM)
{
	if (isDM)
		return message.reply("Must be executed in a text channel");
	return addRemoveRole(message, guild, message.mentions.members.first(), true, config.guestRole);
}

//remguest command processing
function commandRemGuest(message, cmd, args, guild, perm, permName, isDM)
{
	if (isDM)
		return message.reply("Must be executed in a text channel");
	return addRemoveRole(message, guild, message.mentions.members.first(), false, config.guestRole);
}

//purge command processing
function commandPurge(message, cmd, args, guild, perm, permName, isDM)
{
	if (isDM)
		return message.reply("Must be executed in a text channel");
	
	const deleteCount = parseInt(args[0], 10);
	
	if(!deleteCount || deleteCount < 2 || deleteCount > 100)
		return message.reply("Please provide a number between 2 and 100 for the number of messages to delete");

	message.channel.fetchMessages({limit: deleteCount})
		.then(fetched=>message.channel.bulkDelete(fetched)
			.catch(error => message.reply(`Couldn't delete messages because of: ${error}`)))
		.catch(error => message.reply(`Couldn't delete messages because of: ${error}`));
}

//voice command processing
function commandAddChannel(message, cmd, args, guild, perm, permName, isDM)
{
	var temp = true;
	var channelCategory;
	var divisionRole;
	
	if (args[0] === undefined)
		return message.reply("Invalid parameters");
	
	if ((channelCategory = guild.channels.find(c=>{return (c.name.toLowerCase() == args[0].toLowerCase() && c.type == 'category');})))
	{
		if (perm < PERM_STAFF)
			return message.reply("You don't have permissions to add a channel to a specific category");
		if (channelCategory.type != 'category')
			return message.reply("Mentioned channel must be a category");
		if (perm < PERM_ADMIN && channelCategory.children.size >= config.maxChannelsPerCategory)
			return message.reply("Category is full");
		args.shift();
		temp = false;
		
		//check if this category has an associated officer role
		let roleName = channelCategory.name + ' ' + config.discordOfficerSuffix;
		divisionRole = guild.roles.find(r=>{return r.name == roleName;});
	}
	else
	{
		if (cmd === 'text')
			return message.reply("A category must be set for text channels");
		//make sure category exists
		channelCategory = guild.channels.find(c=>{return c.name == config.tempChannelCategory;});
		if (!channelCategory)
			return message.reply("Temp channel category not found");
	}
	
	if (args[0] === undefined)
		return message.reply("Invalid parameters");
	
	//get permissions based on type
	var defaultDeny;
	if (cmd === 'ptt')
		defaultDeny = ['VIEW_CHANNEL','CONNECT','USE_VAD'];
	else
		defaultDeny = ['VIEW_CHANNEL','CONNECT'];
	
	var permissions;
	switch (args[0])
	{
		case 'guest':
			if (perm < PERM_MOD)
				return message.reply("You don't have permissions to add this channel type");
			permissions = getPermissionsForEveryone(guild, [], defaultDeny);
			//add role permissions if necessary
			if (divisionRole)
				permissions = addRoleToPermissions(guild, divisionRole, permissions, ['VIEW_CHANNEL','CONNECT','MANAGE_MESSAGES']);
			args.shift();
			break;
		case 'mod':
			if (perm < PERM_MOD)
				return message.reply("You don't have permissions to add this channel type");
			permissions = getPermissionsForModerators(guild, [], defaultDeny);
			args.shift();
			break;
		case 'staff':
			if (perm < PERM_STAFF)
				return message.reply("You don't have permissions to add this channel type");
			permissions = getPermissionsForStaff(guild, [], defaultDeny);
			args.shift();
			break;
		case 'admin':
			if (perm < PERM_ADMIN)
				return message.reply("You don't have permissions to add this channel type");
			permissions = getPermissionsForAdmin(guild, [], defaultDeny);
			args.shift();
			break;
		default:
			permissions = getPermissionsForMembers(guild, [], defaultDeny);
			//add role permissions if necessary
			if (divisionRole)
				permissions = addRoleToPermissions(guild, divisionRole, permissions, ['VIEW_CHANNEL','CONNECT','MANAGE_MESSAGES']);
			break;
	}

	//check for existing channel
	let channelName = args.join(' ').toLowerCase().replace(/\s/g, '-');
	if (channelName === undefined || channelName == '')
		return message.reply("A name must be provided");
	if (cmd === 'ptt')
	{
		channelName += '-ptt';
		cmd = 'voice';
	}
	var existingChannel = guild.channels.find(c=>{return c.name == channelName;});
	if (existingChannel)
		return message.reply("Channel already exists");
	
	//create channel
	return guild.createChannel(channelName, cmd, permissions, `Requested by ${getNameFromMessage(message)}`)
		.then(c=>{
			//move channel to category
			c.setParent(channelCategory)
				.then(()=>{
					//make sure someone gets into the channel
					if (temp)
						client.setTimeout(function () {
							if (c.members.size === 0)
								c.delete()
									.catch(e=>{}); //probably removed already
						}, 30000);
					//try to move the person requesting the channel to it
					if (message.member)
						message.member.setVoiceChannel(c)
							.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
					return message.reply(`Added channel ${channelName} in ${channelCategory.name}`);
				})
				.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
		})
		.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
}

//remove channel command processing
function commandRemChannel(message, cmd, args, guild, perm, permName, isDM)
{
	//check for existing channel
	let channelName = args.join(' ').toLowerCase().replace(/\s/g, '-');
	if (channelName === undefined || channelName == '')
		return message.reply("A name must be provided");
		
	if (config.protectedChannels.includes(channelName))
		return message.reply(`${channelName} is a protected channel.`);
	
	var existingChannel = guild.channels.find(c=>{return c.name == channelName;});
	if (existingChannel && existingChannel.type !== 'category')
		existingChannel.delete(`Requested by ${getNameFromMessage(message)}`)
			.then(()=>{message.reply(`Channel ${channelName} removed`);});
	else
		return message.reply("Channel not found");
}

//move channel command processing
function commandMoveChannel(message, cmd, args, guild, perm, permName, isDM)
{
	//check for existing channel
	let channelName = args.join(' ');
	if (channelName === undefined || channelName == '')
		return message.reply("A name must be provided");
		
	if (config.protectedChannels.includes(channelName))
		return message.reply(`${channelName} is a protected channel.`);
	
	var existingChannel = guild.channels.find(c=>{return c.name == channelName;});
	if (existingChannel)
		existingChannel.setPosition(cmd === 'up'?-2:2, true)
			.then(()=>{message.reply(`Channel ${channelName} moved`);});
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
function commandAddDivision(message, cmd, args, guild, perm, permName, isDM)
{
	let divisionName = args.join(' ');
	if (divisionName === undefined || divisionName == '')
		return message.reply("A name must be provided");
	let roleName = divisionName + " Officer";
	let simpleName = divisionName.toLowerCase().replace(/\s/g, '-');
	let divisionMembersChannel = simpleName + '-members';
	let divisionOfficersChannel = simpleName + '-officers';
	let divisionPublicChannel = simpleName + '-public';
	
	const divisionCategory = guild.channels.find(c=>{return (c.name == divisionName && c.type == 'category');});
	if (divisionCategory)
		return message.reply("Division already exists.");
	const divisionRole = guild.roles.find(r=>{return r.name == roleName;});
	if (divisionRole)
		return message.reply("Division already exists.");
	
	let permissions = getPermissionsForEveryone(guild);
	//add category for division
	guild.createChannel(divisionName, 'category', permissions, `Requested by ${getNameFromMessage(message)}`)
		.then(cat=>{
			//create role for division
			guild.createRole({name: roleName, permissions: 0, mentionable: true}, `Requested by ${getNameFromMessage(message)}`)
				.then(r=>{
					const memberRole = guild.roles.find(r=>{return r.name == config.memberRole;});
					r.setPosition(memberRole.position+1)
						.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
					
					//add members channel
					let permissions = addRoleToPermissions(guild, r, getPermissionsForMembers(guild), ['VIEW_CHANNEL','CONNECT','MANAGE_MESSAGES']);
					guild.createChannel(divisionMembersChannel, 'text', permissions, `Requested by ${getNameFromMessage(message)}`)
						.then(c=>{
							//move channel to category
							c.setParent(cat)
								.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
						})
						.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
						
					//add officers channel
					permissions = addRoleToPermissions(guild, r, getPermissionsForModerators(guild), ['VIEW_CHANNEL','CONNECT','MANAGE_MESSAGES']);
					guild.createChannel(divisionOfficersChannel, 'text', permissions, `Requested by ${getNameFromMessage(message)}`)
						.then(c=>{
							//move channel to category
							c.setParent(cat)
								.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
							
							/*c.createWebhook(divisionOfficersChannel, '', `Requested by ${getNameFromMessage(message)}`)
								.then(wh=>{
									getWebhookFromAPI(wh.id)
										.then(data=>{
											if (message.member)
												message.member.send({embed: {title:'Webhooks Created', fields:[{name:`${divisionOfficersChannel}`, value:`${data.id}/${data.token}`}]}});
										})
										.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
								})
								.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});*/
								
						})
						.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
						
					//add public channel
					permissions = addRoleToPermissions(guild, r, getPermissionsForEveryone(guild), ['VIEW_CHANNEL','CONNECT','MANAGE_MESSAGES']);					
					guild.createChannel(divisionPublicChannel, 'text', permissions, `Requested by ${getNameFromMessage(message)}`)
						.then(c=>{
							//move channel to category
							c.setParent(cat)
								.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
						})
						.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});

					return message.reply(`${divisionName} division created`);
				})
				.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
		})
		.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
}

//remdivision command processing
function commandRemDivision(message, cmd, args, guild, perm, permName, isDM)
{
	let divisionName = args.join(' ');
	if (divisionName === undefined || divisionName == '')
		return message.reply("A name must be provided");
	let roleName = divisionName + " Officer";
	//let simpleName = divisionName.toLowerCase().replace(/\s/g, '-');
	//let divisionOfficersChannel = simpleName + '-officers';
	//let divisionPublicChannel = simpleName + '-public';
	
	const divisionCategory = guild.channels.find(c=>{return (c.name == divisionName && c.type == 'category');});
	if (divisionCategory)
	{
		if (config.protectedCategories.includes(divisionCategory.name))
			return message.reply(`${divisionName} is a protected category.`);
	
		//remove channels in category
		divisionCategory.children.forEach(function (c) {
			c.delete(`Requested by ${getNameFromMessage(message)}`)
				.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
		});
		//remove category
		divisionCategory.delete(`Requested by ${getNameFromMessage(message)}`)
			.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
		
		//remove role
		const role = guild.roles.find(r=>{return r.name == roleName;});
		if (role)
			role.delete(`Requested by ${getNameFromMessage(message)}`)
				.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
				
		if (forumIntegrationConfig[roleName] !== undefined)
		{
			delete(forumIntegrationConfig[roleName]);
			fs.writeFileSync(config.forumGroupConfig, JSON.stringify(forumIntegrationConfig), 'utf8');
			getRolesByForumGroup(guild, true);
		}
		return message.reply(`${divisionName} division removed`);
	}
	else
	{
		return message.reply(`${divisionName} division not found`);
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
			message.member.send({'embed': embed});
		})
		.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
}*/

function commandMute(message, cmd, args, guild, perm, permName, isDM)
{
	if (isDM)
		return message.reply("Must be executed in a text channel");
	
	let member = message.mentions.members.first();
	if(!member)
		return message.reply("Please mention a valid member of this server");
	var [memberPerm, memberPermName] = getPermissionLevelForMember(member);
	if (perm <= memberPerm)
		return message.reply(`You cannot mute ${member.user.tag}.`);
	
	return addRemoveRole(message, guild, message.mentions.members.first(), cmd==='mute', config.muteRole);
}

function commandPTT(message, cmd, args, guild, perm, permName, isDM)
{
	if (isDM)
		return message.reply("Must be executed in a text channel");
	
	let member = message.mentions.members.first();
	if(!member)
		return message.reply("Please mention a valid member of this server");
	
	/*
	var [memberPerm, memberPermName] = getPermissionLevelForMember(member);
	if (perm <= memberPerm)
		return message.reply(`You cannot mute ${member.user.tag}.`);
	*/
	
	return addRemoveRole(message, guild, message.mentions.members.first(), cmd==='setptt', config.pttRole);
}

//kick command processing
function commandKick(message, cmd, args, guild, perm, permName, isDM)
{
	if (isDM)
		return message.reply("Must be executed in a text channel");
	
	let member = message.mentions.members.first();
	if(!member)
		return message.reply("Please mention a valid member of this server");
	if(!member.kickable) 
		return message.reply(`I cannot kick ${member.user.tag}.`);
	var [memberPerm, memberPermName] = getPermissionLevelForMember(member);
	if (perm <= memberPerm)
		return message.reply(`You cannot kick ${member.user.tag}.`);
	
	args.shift(); //trim mention
	let reason = args.join(' ');
	if(!reason || reason == '') reason = "No reason provided";
	
	member.kick(`Requested by ${getNameFromMessage(message)}: ${reason}`)
		.catch(error => message.reply(`Sorry ${message.author} I couldn't kick because of : ${error}`));
	message.reply(`${member.user.tag} has been kicked by ${message.author.tag} because: ${reason}`);
}

//ban command processing
function commandBan(message, cmd, args, guild, perm, permName, isDM)
{
	if (isDM)
		return message.reply("Must be executed in a text channel");
	
	let member = message.mentions.members.first();
	if(!member)
		return message.reply("Please mention a valid member of this server");
	if(!member.bannable) 
		return message.reply(`I cannot ban ${member.user.tag}.`);
	var [memberPerm, memberPermName] = getPermissionLevelForMember(member);
	if (perm <= memberPerm)
		return message.reply(`You cannot ban ${member.user.tag}.`);

	args.shift(); //trim mention
	let reason = args.join(' ');
	if(!reason || reason == '') reason = "No reason provided";
	
	member.ban(`Requested by ${getNameFromMessage(message)} ${reason}`)
		.catch(error => message.reply(`Sorry ${message.author} I couldn't ban because of : ${error}`));
	message.reply(`${member.user.tag} has been banned by ${message.author.tag} because: ${reason}`);
}

//tracker command processing
function commandTracker(message, cmd, args, guild, perm, permName, isDM)
{
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
	}
	process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
	request(postOptions, function(error, response, body) {
		if (error)
			return message.reply('There was an error processing the request');

		if (body.embed)
			return message.reply({embed: body.embed});
		else if (body.text)
			return message.reply(body.text);
		return message.reply('There was an error processing the request');
	});
}

//get forum groups from forum database
function getForumGroups()
{
	var promise = new Promise(function(resolve, reject)	{
		let db = connectToDB();
		let query = `SELECT usergroupid AS id,title AS name FROM ${config.mysql.prefix}usergroup WHERE title LIKE "AOD%" OR title LIKE "%Officers"`
		db.query(query, function(err, rows, fields) {
			if (err)
				return reject(err)
			else
			{
				let groupsByID = {};
				for (var i in rows)
				{
					groupsByID[rows[i].id] = rows[i].name;
				}
				return resolve(groupsByID);
			}
		});
	});
	return promise;
}

//get forum users from forum groups
function getForumUsersForGroups(groups)
{
	var promise = new Promise(function(resolve, reject) {
		let db = connectToDB();
		let groupStr = groups.join(',');
		let groupRegex = groups.join('|');
		let query = 
			`SELECT u.userid,u.username,f.field19 FROM ${config.mysql.prefix}user AS u ` +
			`INNER JOIN ${config.mysql.prefix}userfield AS f ON u.userid=f.userid ` +
			`WHERE (u.usergroupid IN (${groupStr}) OR u.membergroupids REGEXP '(^|,)(${groupRegex})(,|$)') ` +
			`AND f.field19 IS NOT NULL AND f.field19 <> ''`;
		db.query(query, function(err, rows, fields) {
			if (err)
				return reject(err)
			else
			{
				let usersByUserNameDiscriminator = {};
				for (var i in rows)
				{
					usersByUserNameDiscriminator[rows[i].field19] = {name:rows[i].username,id:rows[i].userid};
				}
				return resolve(usersByUserNameDiscriminator);
			}
		});
	});
	return promise
}

function truncateStr(str, maxLen)
{
	if (str.length <= maxLen)
		return str;
	return str.substr(0, maxLen-5) + ' ...';
}

//do forum sync with discord roles
function doForumSync(message, guild, perm, checkOnly, doDaily)
{
	var hrStart = process.hrtime();
	const guestRole = guild.roles.find(r=>{return r.name == config.guestRole;});
	const sgtsChannel = guild.channels.find(c=>{return c.name==='aod-sergeants'});
	const reason = (message ? `Requested by ${getNameFromMessage(message)}` : 'Periodic Sync');
	
	//first make sure we have something to look at, get the forum groups
	getForumGroups()
		.then(forumGroups=>{
			//track nickname changes once per user
			var nickNameChanges = {};
			//for role/group integration
			Object.keys(forumIntegrationConfig).forEach(roleName=>{
				var groupMap = forumIntegrationConfig[roleName];
				
				//get the current role
				var role;
				if (groupMap.roleID === undefined)
				{
					//make sure we actually have the roleID in our structure
					role = guild.roles.find(r=>{return r.name == roleName;});
					if (role)
						groupMap.roleID = role.id;
				}
				else
					role = guild.roles.get(groupMap.roleID);
				if (role)
				{
					//get all forum users for the forum groups mapped to this role
					getForumUsersForGroups(groupMap.forumGroups)
						.then(usersByUsernameDiscriminator=>{
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
							var membersByUsernaemDiscriminator = {};
							role.members.forEach(m=>{
								membersByUsernaemDiscriminator[m.user.tag] = m;
								let forumUser = usersByUsernameDiscriminator[m.user.tag];
								if (forumUser === undefined)
								{
									toRemove.push(m.user.tag);
									if (!checkOnly)
									{
										m.removeRole(role, reason)
											.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
										if (role.name === config.memberRole)
										{
											//we're removing them from AOD, clear the name set from the forums
											m.setNickname('', reason);
											//Members shouldn't have been guests... lest there be a strange permission thing when AOD members are removed
											if (m.roles.get(guestRole.id))
												m.removeRole(guestRole)
													.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
										}
									}
								}
								else
								{
									if (nickNameChanges[m.user.tag] === undefined && m.displayName !== forumUser.name)
									{
										nickNameChanges[m.user.tag] = true;
										toUpdate.push(`${m.user.tag} (${forumUser.name})`);
										if (!checkOnly)
											m.setNickname(forumUser.name, reason);
									}
									//Members shouldn't also be guests... lest there be a strange permission thing when AOD members are removed
									if (!checkOnly && role.name === config.memberRole)
									{
										if (m.roles.get(guestRole.id))
											m.removeRole(guestRole)
												.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
									}
								}
							});
							
							//for each forum member mapped to the role
							//   if we haven't already seen the guild member
							//       if there is a guild member record, at them to the role and make sure the nickname is valid
							//       otherwise, mark them as an error and move on
							var toAdd = [];
							var noAccount = [];
							Object.keys(usersByUsernameDiscriminator).forEach(u=>{
								if (membersByUsernaemDiscriminator[u] === undefined)
								{
									let forumUser = usersByUsernameDiscriminator[u];
									let guildMember = guild.members.find(m=>{return m.user.tag===u});
									if (guildMember)
									{
										toAdd.push(`${u} (${forumUser.name})`);
										if (!checkOnly)
											guildMember.addRole(role, reason)
												.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
										if (nickNameChanges[guildMember.user.tag] === undefined && guildMember.displayName !== forumUser.name)
										{
											nickNameChanges[guildMember.user.tag] = true;
											toUpdate.push(`${guildMember.user.tag} (${forumUser.name})`);
											if (!checkOnly)
												guildMember.setNickname(forumUser.name, reason);
										}
									}
									else
										noAccount.push(`${u} (${forumUser.name})`);
								}
							});
							
							if (message)
							{
								if (toAdd.length)
									embed.fields.push({
										name: `Members to add (${toAdd.length})`,
										value: truncateStr(toAdd.join(', '), 1024)
									});
									
								if (noAccount.length)
									embed.fields.push({
										name: `Members to add with no discord user (${noAccount.length})`,
										value: truncateStr(noAccount.join(', '), 1024)
									});
									
								if (toRemove.length)
									embed.fields.push({
										name: `Members to remove (${toRemove.length})`,
										value: toRemove.join(', ')
									});
									
								if (toUpdate.length)
									embed.fields.push({
										name: `Members to rename (${toUpdate.length})`,
										value: truncateStr(toUpdate.join(', '), 1024)
									});
								
								var hrEnd = process.hrtime(hrStart);
								embed.footer = {
									text: `> Processing Time: ${hrEnd[0] + (hrEnd[1]/1000000000)}s`
								};
								
								if (toRemove.length || toAdd.length || noAccount.length || toUpdate.length)
									sendReplyToMessageAuthor(message, {'embed': embed});
							}
							else
							{
								if (doDaily === true && noAccount.length)
								{
									if (sgtsChannel)
									{
										embed.fields.push({
											name: `Members to add with no account (${noAccount.length})`,
											value: truncateStr(noAccount.join(', '), 1024)
										});
										sgtsChannel.send({'embed': embed});
									}
								}
							}
						})
						.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
				}
			});
		})
		.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
}

//forum sync command processing
function commandForumSync(message, cmd, args, guild, perm, permName, isDM)
{
	let subCmd = args.shift();
	if (!subCmd)
		return;
	
	switch (subCmd)
	{
		case 'showmap':
		{
			getForumGroups()
				.then(forumGroups=>{
					let embed = { 
						title: 'Configured Group Maps',
						fields: []
					};
					
					Object.keys(forumIntegrationConfig).forEach(roleName=>{
						var groupMap = forumIntegrationConfig[roleName];
						embed.fields.push({
							name: roleName + (groupMap.permanent?' (permanent)':''),
							value: groupMap.forumGroups.map(groupID => `${forumGroups[groupID]} (${groupID})`).join(', ')
						});
					});
					
					sendReplyToMessageAuthor(message, {'embed': embed});
				})
				.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
			break;
		}
		case 'showroles':
		{
			let embed = { 
				title: '',
				fields: [{
					name: 'Discord Officer Roles',
					value: guild.roles.array().filter(r=>r.name.endsWith(config.discordOfficerSuffix)).map(r=>r.name).sort().join("\n")
				}]
			};
			sendReplyToMessageAuthor(message, {'embed': embed});
			break;
		}
		case 'showforumgroups':
		{
			getForumGroups()
				.then(forumGroups=>{
					let embed = { 
						title: '',
						fields: [{
							name: 'AOD Forum Groups',
							value: Object.keys(forumGroups).map(k => `${forumGroups[k]} (${k})`).sort().join("\n")
						}]
					};
					sendReplyToMessageAuthor(message, {'embed': embed});
				})
				.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
			break;
		}
		case 'check':
			doForumSync(message, guild, perm, true);
			break;
		case 'sync':
			doForumSync(message, guild, perm, false);
			break;
		case 'add':
		{
			let roleName = args.shift();
			let groupName = args.shift();
			
			if (!roleName.endsWith(config.discordOfficerSuffix))
				return message.reply('Only Officer Roles may be mapped');
			if (!groupName.endsWith(config.forumOfficerSuffix))
				return message.reply('Only Officer Groups may be mapped');
			
			const role = guild.roles.find(r=>{return r.name == roleName;});
			if (!role)
				return message.reply(`${roleName} role not found`);
			let map = forumIntegrationConfig[role.name];
			if (map && map.permanent)
				return message.reply(`${roleName} can not be edited`);
			
			getForumGroups()
				.then(forumGroups=>{
					var forumGroupId = parseInt(Object.keys(forumGroups).find(k=>{
						if (forumGroups[k] !== groupName)
							return false;
						return true;
					}), 10);
					if (forumGroupId !== undefined && forumGroupId !== NaN)
					{
						//don't use the version from our closure to prevent asynchronous stuff from causing problems
						let map = forumIntegrationConfig[role.name];
						if (map === undefined)
						{
							forumIntegrationConfig[role.name] = {
								permanent: false,
								forumGroups: [forumGroupId],
								roleID: `${role.id}`
							};
							fs.writeFileSync(config.forumGroupConfig, JSON.stringify(forumIntegrationConfig), 'utf8');
							getRolesByForumGroup(guild, true);
							return message.reply(`Mapped group ${groupName} to role ${role.name}`);
						}
						else
						{
							let index = map.forumGroups.indexOf(forumGroupId);
							if (index < 0)
							{
								map.forumGroups.push[forumGroupId];
								fs.writeFileSync(config.forumGroupConfig, JSON.stringify(forumIntegrationConfig), 'utf8');
								getRolesByForumGroup(guild, true);
								return message.reply(`Mapped group ${groupName} to role ${role.name}`);
							}
							else
							{
								return message.reply('Map already exists');
							}
						}
					}
					else
					{
						return message.reply(`${groupName} group not found`);
					}
				})
				.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
			break;
		}
		case 'rem':
		{
			let roleName = args.shift();
			let groupName = args.shift();
			
			if (!roleName.endsWith('Officer'))
				return message.reply('Only Officer Roles may be mapped');
			if (!groupName.endsWith('Officers'))
				return message.reply('Only Officer Groups may be mapped');
			
			const role = guild.roles.find(r=>{return r.name == roleName;});
			if (!role)
				return message.reply(`${roleName} role not found`);
			let map = forumIntegrationConfig[role.name];
			if (!map)
				return message.reply('Map does not exist');
			if (map.permanent)
				return message.reply(`${roleName} can not be edited`);
			
			getForumGroups()
				.then(forumGroups=>{
					var forumGroupId = parseInt(Object.keys(forumGroups).find(k=>{
						if (forumGroups[k] !== groupName)
							return false;
						return true;
					}), 10);
					
					let map = forumIntegrationConfig[role.name];
					let index = map.forumGroups.indexOf(forumGroupId);
					if (index < 0)
					{
						return message.reply('Map does not exist');
					}
					else
					{
						map.forumGroups.splice(index, 1);
						if (map.forumGroups.length === 0)
							delete forumIntegrationConfig[role.name];
						fs.writeFileSync(config.forumGroupConfig, JSON.stringify(forumIntegrationConfig), 'utf8');
						getRolesByForumGroup(guild, true);
						return message.reply(`Removed map of group ${groupName} to role ${role.name}`);
					}
				})
				.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
		}
	}	
}

//function to send a message to a change that always returns a promise (simplifies exception handling)
function sendMessageToChannel(channel, content)
{
	let json;
	try { json = JSON.parse(content); } catch(e) {};
	
	if (json !== undefined)
	{
		if (json.embed)
			return channel.send({'embed': json.embed});
		else if (json.text)
			return channel.send(json.text);
	}
	else
		return channel.send(content);
}

//relay command processing
function commandRelay(message, cmd, args, guild, perm, permName, isDM)
{
	if (isDM)
		return;
	if (args.length === 0)
		return;
	
	let channelName = args[0].toLowerCase();
	let channel = guild.channels.find(c=>{return (c.name.toLowerCase() == channelName)});
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
		.then(()=>{message.delete();})
		.catch(()=>{message.delete();});
}

//ban command processing
function commandSetAdmin(message, cmd, args, guild, perm, permName, isDM)
{
	if (isDM)
		return message.reply("Must be executed in a text channel");
	
	let member = message.mentions.members.first();
	let add = (cmd==='addadmin');
	if(!member)
		return message.reply("Please mention a valid member of this server");
	
	addRemoveRole(message, guild, member, add, 'Admin');
	message.reply(`${member.user.tag} has been ${add?'added to':'removed from'} the Admin role`);
}

//reload command processing
function commandReload(message, cmd, args, guild, perm, permName, isDM)
{
	console.log(`Reload config requested by ${getNameFromMessage(message)}`);
	config = require('./aod-discord-bot.config.json');
	message.reply('Configuration reloaded');
}

//status command processing
function commandStatus(message, cmd, args, guild, perm, permName, isDM)
{
	let uptimeSeconds = Math.round(client.uptime/1000);
	let uptimeMinutes = Math.floor(uptimeSeconds/60);
	uptimeSeconds -= (uptimeMinutes*60);
	let uptimeHours = Math.floor(uptimeMinutes/60);
	uptimeMinutes -= (uptimeHours*60);
	let uptimeDays = Math.floor(uptimeHours/24);
	uptimeHours -= (uptimeDays*24);
	
	let lastTimeSyncDiff = new Date(new Date() - lastTimeSync);
	
	let embed = {
		title: 'Bot Status',
		fields: [
			{name: 'UpTime', value: `${uptimeDays} days, ${uptimeHours} hours, ${uptimeMinutes} minutes, ${uptimeSeconds} seconds`},
			{name: 'Server Status', value: `${guild.name} has ${guild.members.size} members and ${guild.channels.size} channels`},
			{name: 'Server Region', value: `${guild.region}`},
			{name: 'Last Time Sync', value: `${lastTimeSyncDiff.getMinutes()} minutes, ${lastTimeSyncDiff.getSeconds()} seconds ago`},
			{name: 'Average WebSocket Hearbeat Time', value: `${client.ping}ms for ${client.pings.length} pings`},
		]
	};
	
	message.reply({embed: embed});
}

//quit command processing
function commandQuit(message, cmd, args, guild, perm, permName, isDM)
{
	console.log(`Bot quit requested by ${getNameFromMessage(message)}`);
	client.destroy();
	process.exit();
}

/*function commandDoUpdate(message, cmd, args, guild, perm, permName, isDM)
{
	guild.channels.forEach(c=>{
		if (c.type === 'category')
		{
			//check if this category has an associated officer role
			let roleName = c.name + ' ' + config.discordOfficerSuffix;
			divisionRole = guild.roles.find(r=>{return r.name == roleName;});
			if (divisionRole)
			{
				let action = "";
				c.children.forEach(divisionChannel=>{
					//['','','']);
					action += `add ${divisionRole.name} to ${divisionChannel.name}\n`;
					divisionChannel.overwritePermissions(divisionRole, {
						VIEW_CHANNEL: true,
						CONNECT: true,
						MANAGE_MESSAGES: true
					});
				});
				message.reply(action);
			}
		}
	});
}*/

//command definitions
commands = {
	/*
	command: {
		minPermission: PERM_LEVEL,
		args: "String",
		helpText: "String",
		callback: function(message, cmd, args, guild, perm, permName, isDM)
	},
	*/
	help: {
		minPermission: PERM_GUEST,
		args: "",
		helpText: "Displays the help menu.",
		callback: commandHelp
	},
	ping: {
		minPermission: PERM_GUEST,
		args: "",
		helpText: "Returns a DM letting you know the bot is alive. Staff and Moderators will get an estimate of network latency.",
		callback: commandPing
	},
	tracker: {
		minPermission: PERM_MEMBER,
		args: "<query>",
		helpText: "Clan Tracker Integration",
		callback: commandTracker
	},
	mute: {
		minPermission: PERM_MOD,
		args: "@mention",
		helpText: "Adds the Muted role to the user.",
		callback: commandMute
	},
	unmute: {
		minPermission: PERM_MOD,
		args: "@mention",
		helpText: "Removes the Muted role from the user.",
		callback: commandMute
	},
	setptt: {
		minPermission: PERM_MOD,
		args: "@mention",
		helpText: "Adds the Force Push-to-Talk role to the user.",
		callback: commandPTT
	},
	clearptt: {
		minPermission: PERM_MOD,
		args: "@mention",
		helpText: "Removes the Force Push-to-Talk role from the user.",
		callback: commandPTT
	},
	kick: {
		minPermission: PERM_RECRUITER,
		args: "@mention [<reason>]",
		helpText: "Kicks the mentioned user from the server.",
		callback: commandKick
	},
	ban: {
		minPermission: PERM_MOD,
		args: "@mention [<reason>]",
		helpText: "Bans the mentioned user from the server.",
		callback: commandKick
	},
	addaod: {
		minPermission: PERM_RECRUITER,
		args: "@mention",
		helpText: "Adds the mentioned user to the AOD Members role.",
		callback: commandAddAOD
	},
	remaod: {
		minPermission: PERM_MOD,
		args: "@mention",
		helpText: "Removes the mentioned user from the AOD Members role.",
		callback: commandRemAOD
	},
	addguest: {
		minPermission: PERM_MOD,
		args: "@mention",
		helpText: "Adds the mentioned user to the Guest role.",
		callback: commandAddGuest
	},
	remguest: {
		minPermission: PERM_MOD,
		args: "@mention",
		helpText: "Removes the mentioned user from the Guest role.",
		callback: commandRemGuest
	},
	voice: {
		minPermission: PERM_RECRUITER,
		args: "[<category>] [<guest|mod|staff|admin>] <name>",
		helpText: ["Creates a temporary voice channel visible to Members+ by default.",
			"*guest*: channel is visible to Guest+ (requires Moderator permissions)",
			"*mod*: channel is visible to Moderator+ (requires Moderator permissions)",
			"*staff*: channel is visible to Staff+ (requires Staff permissions)",
			"*admin*: channel is visible to Admins (requires Admin permissions)"],
		callback: commandAddChannel
	},
	ptt: {
		minPermission: PERM_RECRUITER,
		args: "[<category>] [<guest|mod|staff|admin>] <name>",
		helpText: ["Same a 'voice', however, the channel will force PTT"],
		callback: commandAddChannel
	},
	text: {
		minPermission: PERM_STAFF,
		args: "<category> [<guest|mod|staff|admin>] <name>",
		helpText: ["Creates a text channel visible to Members+ by default.",
			"*guest*: channel is visible to Guest+ (requires Moderator permissions)",
			"*mod*: channel is visible to Moderator+ (requires Moderator permissions)",
			"*staff*: channel is visible to Staff+ (requires Staff permissions)",
			"*admin*: channel is visible to Admins (requires Admin permissions)"],
		callback: commandAddChannel
	},
	remchannel: {
		minPermission: PERM_STAFF,
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
	purge: {
		minPermission: PERM_STAFF,
		args: "<num>",
		helpText: "Purges the last <num> messages from the channel the command was run in (2 <= num <= 100).",
		callback: commandPurge
	},
	forumsync: {
		minPermission: PERM_MOD,
		args: "<cmd> [<options>]",
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
		args: "[\"<channel>\"] \"<message>\"",
		helpText: "Relay a message using the bot. If <channel> is provided, the message will be sent there.",
		callback: commandRelay
	},
	addadmin: {
		minPermission: PERM_OWNER,
		args: "@mention",
		helpText: "Add the Admin role to a user",
		callback: commandSetAdmin
	},
	remadmin: {
		minPermission: PERM_OWNER,
		args: "@mention",
		helpText: "Remove the Admin role from a user",
		callback: commandSetAdmin
	},
	reload: {
		minPermission: PERM_OWNER,
		args: "",
		helpText: "Reload the configuration",
		callback: commandReload
	},
	status: {
		minPermission: PERM_ADMIN,
		args: "",
		helpText: "Bot Status",
		callback: commandStatus
	},
	quit: {
		minPermission: PERM_OWNER,
		args: "",
		helpText: "Terminate the bot",
		callback: commandQuit
	},
	/*update: {
		minPermission: PERM_OWNER,
		args: "",
		helpText: "Temporary command to do bulk updates",
		callback: commandDoUpdate
	},*/
}

//process commands
function processCommand(message, cmd, args, guild, perm, permName, isDM)
{
	var commandObj = commands[cmd];
	if (commandObj !== undefined)
	{
		if (commandObj.minPermission <= perm)
		{
			if (cmd !== 'help' && cmd !== 'ping')
				console.log(`${getNameFromMessage(message)} executed: ${cmd} "${args.join('" "')}"`)
			return commandObj.callback(message, cmd, args, guild, perm, permName, isDM);
		}
	}
}


//message event handler -- triggered when client receives a message from a text channel or DM
client.on("message", message=>{
	//check for prefix
	if(!message.content.startsWith(config.prefix)) return;
	
	//make sure we have a member
	var isDM = false;
	var guild, role, perm, permName;
	if (!message.member)
	{
		if (message.author.bot)
		{
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
		}
		else
		{
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
	}
	else
	{
		guild = message.member.guild;
		if (!guild)
			return; //must have guild
		[perm, permName] = getPermissionLevelForMember(message.member);
	}

	//if no valid perms, stop now
	if (perm == PERM_NONE)
		return;
	
	//process arguments and command
	const args = getParams(message.content.slice(config.prefix.length).trim());
	const command = args.shift().toLowerCase();
	try {
		return processCommand(message, command, args, guild, perm, permName, isDM);
	} catch (error) {notifyRequestError(error,message,(perm >= PERM_MOD));} //don't let user input crash the bot
});

//voiceStateUpdate event handler -- triggered when a user joins or leaves a channel or their status in the channel changes
client.on('voiceStateUpdate', (oldMember, newMember)=>{
	//if the user left the channel, check if we should delete it
	if (oldMember.voiceChannelID != newMember.voiceChannelID)
	{
		if (oldMember.voiceChannel)
		{
			const guild = client.guilds.get(config.guildId);
			const oldCategory = guild.channels.get(oldMember.voiceChannel.parentID);
			if (oldCategory && oldCategory.name === config.tempChannelCategory)
			{
				if (oldMember.voiceChannel.members.size === 0)
				{
					oldMember.voiceChannel.delete();
				}
			}
		}
	}
});

//get forum group for guild member
function getForumGroupsForMember(member)
{
	var promise = new Promise(function(resolve, reject) {
		let db = connectToDB();
		let query = 
			`SELECT u.userid,u.username,f.field19,u.usergroupid,u.membergroupids FROM ${config.mysql.prefix}user AS u ` +
			`INNER JOIN ${config.mysql.prefix}userfield AS f ON u.userid=f.userid ` +
			`WHERE f.field19 LIKE "${member.user.tag}"`;
		db.query(query, function(err, rows, fields) {
			if (err)
				reject(err)
			else
			{
				if (rows === undefined || rows.length === 0)
				{
					return resolve();
				}
				if (rows.length > 1) //danger will robinson! name conflict in database
				{
					member.send("Hello AOD member! There is a conflict with your discord name. Please verify your profile and contact the leadership for help.");
					return reject(`Member name conflict: ${rows.length} members have the discord tag ${member.user.tag}`);
				}
				
				let row = rows.shift();
				let forumGroups = [];
				if (row.usergroupid !== undefined)
					forumGroups.push(row.usergroupid);
				if (row.membergroupids !== undefined)
					forumGroups = forumGroups.concat(row.membergroupids.split(','));
				return resolve({name: row.username, groups: forumGroups});
			}
		});
	});
	return promise;
}

//guildMemberAdd event handler -- triggered when a user joins the guild
client.on('guildMemberAdd', (member)=>{
	getForumGroupsForMember(member)
		.then(data=>{
			if (data === undefined || data.groups.length === 0)
				return;
			
			let rolesByGroup = getRolesByForumGroup(member.guild);
			let rolesAdded = [];
			for (var i in data.groups)
			{
				var group = data.groups[i];
				if (rolesByGroup[group] !== undefined)
				{
					Object.keys(rolesByGroup[group]).forEach(roleName=>{
						let role = rolesByGroup[group][roleName];
						
						if (role && !member.roles.get(role.id))
						{
							member.addRole(role, 'First time join')
								.catch(console.error);
							rolesAdded.push(role.name);
						}
					});
				}
			}
			if (member.displayName !== data.name)
				member.setNickname(data.name, 'First time join');
			member.send(`Hello ${data.name}! The following roles have been automatically granted: ${rolesAdded.join(', ')}. Use '!help' to see available commands.`);
		})
		.catch(console.error);
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
function forumSyncTimerCallback()
{
	lastTimeSync = new Date();
	let currentDate = `${lastTimeSync.getFullYear()}/${lastTimeSync.getMonth()+1}/${lastTimeSync.getDate()}`;
	const guild = client.guilds.get(config.guildId);
	let doDaily = false;
	
	//console.log(`Forum sync timer called; currentDate=${currentDate} lastDate=${lastDate}`);
	
	if (lastDate !== null && lastDate !== currentDate)
		doDaily = true;
	lastDate = currentDate;
	doForumSync(null, guild, PERM_NONE, false, doDaily);
	if (doDaily)
		guild.pruneMembers(14, 'Forum sync timer')
			.catch(console.error);
}

//ready handler
client.on("ready", () => {
	console.log(`Bot has started, with ${client.users.size} users, in ${client.channels.size} channels of ${client.guilds.size} guilds.`); 
	
	//remove any empty temp channels
	const guild = client.guilds.get(config.guildId);
	const tempChannelCategory = guild.channels.find(c=>{return c.name == config.tempChannelCategory;});
	if (tempChannelCategory && tempChannelCategory.children && tempChannelCategory.children.size)
	{
		tempChannelCategory.children.forEach(function (c) {
			if (c.type == 'voice')
			{
				if (c.members.size === 0)
					c.delete();
			}
		});
	}
	
	forumSyncTimerCallback(); //prime the date and do initial adds
	forumSyncTimer = client.setInterval(forumSyncTimerCallback, config.timeSyncIntervalMS);
});

//common client error handler
client.on('error', console.error);

//everything is defined, start the client
client.login(config.token)
	.catch(console.error);
