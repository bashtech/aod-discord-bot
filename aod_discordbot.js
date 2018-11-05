
//include discord.js
const Discord = require("discord.js");

//include request
var request = require('request');

//include config
const config = require("./aod_discordbot_config.json");

//permission levels
const PERM_ADMIN = 10;
const PERM_STAFF = 9;
const PERM_MOD = 8;
const PERM_RECRUITER = 7;
const PERM_MEMBER = 6;
const PERM_GUEST = 1;
const PERM_NONE = 0;

//global undefined for readable code
var undefined;

//initialize client
const client = new Discord.Client({
	sync: true
});

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
		member.addRole(role, "Requested by " + message.member.user.tag)
						.then(message.reply("Added " + role.name + " to " + member.user.tag))
						.catch(console.error);
	else
		member.removeRole(role, "Requested by " + message.member.user.tag)
						.then(message.reply("Removed " + role.name + " from " + member.user.tag))
						.catch(console.error);
}

function getPermissionLevelFromRole(r)
{
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
function addRoleToPermissions(guild, role, permissions)
{
	let newPerm = {
		type: 'role',
		id: role.id,
		allow: ['VIEW_CHANNEL','CONNECT']
	};
	permissions.push(newPerm);
	return permissions;
}
//build a list of permissions for admin
function getPermissionsForAdmin(guild)
{
	//NOTE: USE_VAD controls voice activated detection
	let permissions = [{id:guild.id,deny:['VIEW_CHANNEL','CONNECT']}]; //default no one can view
	// add admin
	config.adminRoles.forEach(n=>{
		const role = guild.roles.find(r=>{return r.name == n;});
		if (role)
		{
			let newPerm = {
				type: 'role',
				id: role.id,
				allow: ['VIEW_CHANNEL','CONNECT']
			};
			permissions.push(newPerm);
		}
	});
	return permissions;
}
//build a list of permissions for staff+
function getPermissionsForStaff(guild)
{
	let permissions = getPermissionsForAdmin(guild);
	// add staff
	config.staffRoles.forEach(n=>{
		const role = guild.roles.find(r=>{return r.name == n;});
		if (role)
		{
			let newPerm = {
				type: 'role',
				id: role.id,
				allow: ['VIEW_CHANNEL','CONNECT']
			};
			permissions.push(newPerm);
		}
	});
	return permissions;
}
//build a list of permissions for mod+
function getPermissionsForModerators(guild)
{
	let permissions = getPermissionsForStaff(guild);
	// add moderators
	config.modRoles.forEach(n=>{
		const role = guild.roles.find(r=>{return r.name == n;});
		if (role)
		{
			let newPerm = {
				type: 'role',
				id: role.id,
				allow: ['VIEW_CHANNEL','CONNECT']
			};
			permissions.push(newPerm);
		}
	});
	return permissions;
}
//build a list of permissions for member+
function getPermissionsForMembers(guild)
{
	let permissions = getPermissionsForModerators(guild);
	const memberRole = guild.roles.find(r=>{return r.name == config.memberRole;});
	return addRoleToPermissions(guild, memberRole, permissions);
}
//build a list of permissions for guest+
function getPermissionsForEveryone(guild)
{
	let permissions = getPermissionsForMembers(guild);
	const guestRole = guild.roles.find(r=>{return r.name == config.guestRole;});
	return addRoleToPermissions(guild, guestRole, permissions);
}


/*************************************
	Command Processing Functions
 *************************************/

//forward declaration of commands in case any of the functions need it
var commands; 
 
//params parsing
var paramsRegEx = /[^\s"]+|"([^"]*)"|'([^']*)'/g;
function getParams(string)
{
	paramsRegEx.lastIndex = 0;
	var params = [];
	do {
		//Each call to exec returns the next regex match as an array
		var match = paramsRegEx.exec(string);
		if (match != null)
			params.push(match[1] ? match[1] : match[0]);
	} while (match != null);
	return params;	
}

//log and notify of errors processing commands
function notifyRequestError(error, message, showError)
{
	console.error(error);
	if (showError && message && message.member)
	{
		message.member.send('An error occurred while processing your request: ' + message.content + "\n" + error.toString())
			.catch(console.error);
	}
}

//help command processing
function commandHelp(message, cmd, args, guild, perm, permName, isDM)
{
	var helpText = `User Level: **${permName}**\n\nCommands:\n`;
	Object.keys(commands).forEach(cmd=>{
		let commandObj = commands[cmd];
		if (commandObj.minPermission <= perm)
		{
			let commandHelp = commandObj.helpText;
			if (Array.isArray(commandHelp))
				commandHelp = commandHelp.join("\n\t\t\t");
			helpText += `\t**${cmd} ${commandObj.args}**\n\t\t${commandHelp}\n`
		}
	});
	helpText += "\n**Note**: Parameters that require spaces should be 'single' or \"double\" quoted.\n";
	return message.member.send(helpText)
		.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
}

//ping command processing
function commandPing(message, cmd, args, guild, perm, permName, isDM)
{
	if (perm >= PERM_STAFF)
		message.member.send("Ping?")
			.then(m => {m.edit(`Pong! Latency is ${m.createdTimestamp - message.createdTimestamp}ms. API Latency is ${Math.round(client.ping)}ms`).catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});})
			.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
	else
		message.member.send("Pong!")
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
	
	//get permissions based on type
	var permissions;
	switch (args[0])
	{
		case 'guest':
			if (perm < PERM_MOD)
				return message.reply("You don't have permissions to add this channel type");
			permissions = getPermissionsForEveryone(guild);
			args.shift();
			break;
		case 'mod':
		if (perm < PERM_MOD)
				return message.reply("You don't have permissions to add this channel type");
			permissions = getPermissionsForModerators(guild);
			args.shift();
			break;
		case 'staff':
			if (perm < PERM_STAFF)
				return message.reply("You don't have permissions to add this channel type");
			permissions = getPermissionsForStaff(guild);
			args.shift();
			break;
		case 'admin':
			if (perm < PERM_ADMIN)
				return message.reply("You don't have permissions to add this channel type");
			permissions = getPermissionsForAdmin(guild);
			args.shift();
			break;
		default:
			permissions = getPermissionsForMembers(guild);
			break;
	}
	
	//check for existing channel
	let channelName = args.join(' ').toLowerCase().replace(/\s/g, '-');
	if (channelName === undefined || channelName == '')
		return message.reply("A name must be provided");
	var existingChannel = guild.channels.find(c=>{return c.name == channelName;});
	if (existingChannel)
		return message.reply("Channel already exists");
	
	//create channel
	return guild.createChannel(channelName, cmd, permissions)
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
					message.member.setVoiceChannel(c)
						.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
					return message.reply(`Added channel ${channelName} in ${channelCategory.name}`);
				})
				.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
		})
		.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
}

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
		existingChannel.delete()
			.then(()=>{message.reply(`Channel ${channelName} removed`);});
	else
		return message.reply("Channel not found");
}

//adddivision command processing
function commandAddDivision(message, cmd, args, guild, perm, permName, isDM)
{
	let divisionName = args.join(' ');
	if (divisionName === undefined || divisionName == '')
		return message.reply("A name must be provided");
	let roleName = divisionName + " Officer";
	let simpleName = divisionName.toLowerCase().replace(/\s/g, '-');
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
	guild.createChannel(divisionName, 'category', permissions)
		.then(cat=>{
			const memberRole = guild.roles.find(r=>{return r.name == config.memberRole;});
			//create role for division
			guild.createRole({name: roleName, permissions: 0, position: memberRole.position+1})
				.then(r=>{
					//add members channel
					let permissions = getPermissionsForMembers(guild);
					guild.createChannel(simpleName, 'text', permissions)
						.then(c=>{
							//move channel to category
							c.setParent(cat)
								.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
						})
						.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
						
					//add officers channel
					permissions = getPermissionsForModerators(guild);
					permissions = addRoleToPermissions(guild, r, permissions);
					guild.createChannel(divisionOfficersChannel, 'text', permissions)
						.then(c=>{
							//move channel to category
							c.setParent(cat)
								.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
						})
						.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
						
					//add public channel
					permissions = getPermissionsForEveryone(guild);							
					guild.createChannel(divisionPublicChannel, 'text', permissions)
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
	let simpleName = divisionName.toLowerCase().replace(/\s/g, '-');
	//let divisionOfficersChannel = simpleName + '-officers';
	//let divisionPublicChannel = simpleName + '-public';
	
	const divisionCategory = guild.channels.find(c=>{return (c.name == divisionName && c.type == 'category');});
	if (divisionCategory)
	{
		if (config.protectedCategories.includes(c.name))
			return message.reply(`${divisionName} is a protected category.`);
	
		//remove channels in category
		divisionCategory.children.forEach(function (c) {
			c.delete()
				.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
		});
		//remove category
		divisionCategory.delete()
			.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
		
		//remove role
		const role = guild.roles.find(r=>{return r.name == roleName;});
		if (role)
			role.delete()
				.catch(error=>{notifyRequestError(error,message,(perm >= PERM_MOD))});
				
		return message.reply(`${divisionName} division removed`);
	}
	else
	{
		return message.reply(`${divisionName} division not found`);
	}
}

function commandKick(message, cmd, args, guild, perm, permName, isDM)
{
	if (isDM)
		return message.reply("Must be executed in a text channel");
	
	let member = message.mentions.members.first();
	if(!member)
		return message.reply("Please mention a valid member of this server");
	if(!member.kickable) 
		return message.reply(`I cannot kick ${member.user.tag}.`);
	var [memberPerm, memberPermName] = getPermissionLevelFromRole(member.highestRole);
	if (perm <= memberPerm)
		return message.reply(`You cannot kick ${member.user.tag}.`);
	
	args.shift(); //trim mention
	let reason = args.join(' ');
	if(!reason || reason == '') reason = "No reason provided";
	
	member.kick(reason)
		.catch(error => message.reply(`Sorry ${message.author} I couldn't kick because of : ${error}`));
	message.reply(`${member.user.tag} has been kicked by ${message.author.tag} because: ${reason}`);
}

function commandBan(message, cmd, args, guild, perm, permName, isDM)
{
	if (isDM)
		return message.reply("Must be executed in a text channel");
	
	let member = message.mentions.members.first();
	if(!member)
		return message.reply("Please mention a valid member of this server");
	if(!member.bannable) 
		return message.reply(`I cannot ban ${member.user.tag}.`);
	var [memberPerm, memberPermName] = getPermissionLevelFromRole(member.highestRole);
	if (perm <= memberPerm)
		return message.reply(`You cannot ban ${member.user.tag}.`);

	args.shift(); //trim mention
	let reason = args.join(' ');
	if(!reason || reason == '') reason = "No reason provided";
	
	member.ban(reason)
		.catch(error => message.reply(`Sorry ${message.author} I couldn't ban because of : ${error}`));
	message.reply(`${member.user.tag} has been banned by ${message.author.tag} because: ${reason}`);
}


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
	});
}

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
		minPermission: PERM_MEMBER,
		args: "[<category>] [<guest|mod|staff|admin>] <name>",
		helpText: ["Creates a temporary voice channel visible to Members+ by default.",
			"guest: channel is visible to Guest+ (requires Moderator permissions)",
			"mod: channel is visible to Moderator+ (requires Moderator permissions)",
			"staff: channel is visible to Staff+ (requires Staff permissions)",
			"admin: channel is visible to Admins (requires Admin permissions)"],
		callback: commandAddChannel
	},
	text: {
		minPermission: PERM_MEMBER,
		args: "<category> [<guest|mod|staff|admin>] <name>",
		helpText: ["Creates a text channel visible to Members+ by default.",
			"guest: channel is visible to Guest+ (requires Moderator permissions)",
			"mod: channel is visible to Moderator+ (requires Moderator permissions)",
			"staff: channel is visible to Staff+ (requires Staff permissions)",
			"admin: channel is visible to Admins (requires Admin permissions)"],
		callback: commandAddChannel
	},
	remchannel: {
		minPermission: PERM_STAFF,
		args: "<name>",
		helpText: "Removes a channel.",
		callback: commandRemChannel
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
}

//process commands
function processCommand(message, cmd, args, guild, perm, permName, isDM)
{
	var commandObj = commands[cmd];
	if (commandObj !== undefined)
	{
		if (commandObj.minPermission <= perm)
		{
			return commandObj.callback(message, cmd, args, guild, perm, permName, isDM);
		}
	}
}


//message event handler -- triggered when client receives a message from a text channel or DM
client.on("message", message=>{
	//ignore bots
	if(message.author.bot) return;
	
	//check for prefix
	if(!message.content.startsWith(config.prefix)) return;
	
	//make sure we have a member
	var isDM = false;
	if (!message.member)
	{
		isDM = true;
		const guild = client.guilds.get(config.guildId);
		if (guild)
		{
			const member = guild.member(message.author);
			if (member)
				message.member = member;
		}
		if (!message.member)
			return;
	}
	
	//get permission
	const r = message.member.highestRole;
	var [perm, permName] = getPermissionLevelFromRole(r);
	
	//if no valid perms, stop now
	if (perm == PERM_NONE)
		return;
	
	//process arguments and command
	const args = getParams(message.content.slice(config.prefix.length).trim());
	const command = args.shift().toLowerCase();
	const guild = message.member.guild;
	return processCommand(message, command, args, guild, perm, permName, isDM);
});

//voiceStateUpdate event handler -- triggered when a user joins or leaves a channel or their status in the channel changes
client.on('voiceStateUpdate', (oldData, newData)=>{
	//if the user left the channel, check if we should delete it
	if (oldData.voiceChannelID != newData.voiceChannelID)
	{
		if (oldData.voiceChannel)
		{
			const guild = client.guilds.get(config.guildId);
			const oldCategory = guild.channels.get(oldData.voiceChannel.parentID);
			if (oldCategory && oldCategory.name === config.tempChannelCategory)
			{
				if (oldData.voiceChannel.members.size === 0)
				{
					oldData.voiceChannel.delete();
				}
			}
		}
	}
});

//common client error handler
client.on('error', console.error);

//everything is defined, start the client
client.login(config.token)
	.catch(console.error);
