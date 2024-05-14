/* jshint esversion: 11 */

const express = require('express');
const {
	ChannelType
} = require('discord.js');

const app = express();
app.disable('x-powered-by');
app.use(express.json({
	verify: (req, res, buf) => {
		req.rawBody = buf;
	}
})); //parse application/json input data

//WARNING: handlers are processed in the order of definition

//check Authorization header
app.all('*', (req, res, next) => {
	//all responses are json
	res.type('application/json');
	req.client_ip = /*req.headers['x-forwarded-for'] ||*/ req.socket.remoteAddress;
	if (!global.config.botAPIAllowedIPs.length || global.config.botAPIAllowedIPs.includes(req.client_ip)) {
		let auth_hdr = req.get('Authorization');
		if (auth_hdr) {
			let token_data = auth_hdr.split(' ');
			if (token_data.length >= 2 && token_data[0].toLowerCase() === 'bearer' &&
				token_data[1] === global.config.botAPIToken) {
				next();
				return;
			}
		}
	}
	console.log(`API: [${req.client_ip}] Unauthorized access`);
	res.status(401).send({ error: 'Not authorized' });
});

////////////////////////////
// api router
////////////////////////////

const apiRouter = express.Router();
app.use('/api', apiRouter);

//ensure discord is ready before calling any APIs
apiRouter.all('*', (req, res, next) => {
	if (!global.client || !global.client.isReady()) {
		console.log(`API: [${req.client_ip}] Discord client not ready`);
		res.status(503).send({ error: 'Discord client not ready' });
		return;
	} else {
		req.guild = global.client.guilds.resolve(config.guildId);
	}
	let requested_by_hdr = req.get('X-Requested-By');
	if (requested_by_hdr) {
		//FIXME: should this be required?
		req.reqMember = getMember(req.guild, requested_by_hdr);
		if (!req.reqMember) {
			console.log(`API: [${req.client_ip}] Unknown requestor`);
			res.status(400).send({ error: 'Unknown requestor' });
			return;
		}
	}
	next();
});

////////////////////////////
// message router
////////////////////////////

const messageRouter = express.Router();

//common message_id processing
messageRouter.param('message_id', async (req, res, next, message_id) => {
	if (res.writableEnded) {
		//do nothing if response already sent
		next();
		return;
	}

	if (!req.channel) {
		res.status(404).send({ error: 'No channel' });
	} else if (!req.channel.isTextBased()) {
		res.status(400).send({ error: 'Channel must be text based' });
	} else {
		let message = await req.channel.messages.fetch(message_id).catch(() => {});
		if (!message) {
			res.status(404).send({ error: 'Unknown message' });
		} else {
			req.message = message;
		}
	}
	next();
});

const unicodeRegEx = /&#([0-9]+);/g; //BE CAREFUL OF CAPTURE GROUPS BELOW
const unicodeHexRegEx = /&#x([0-9a-fA-F]+);/g; //BE CAREFUL OF CAPTURE GROUPS BELOW
messageRouter.post('/:message_id/react', async (req, res, next) => {
	if (res.writableEnded) {
		//do nothing if response already sent
		next();
		return;
	}

	let emjoiId;
	if (!req.body.emoji) {
		res.status(400).send({ error: 'emoji must be provided' });
	} else {
		let emoji = global.client.emojis.resolve(req.body.emoji);
		if (!emoji) {
			req.body.emoji = req.body.emoji.replace(unicodeRegEx, function() {
				//arguments[0] = full unicode
				//arguments[1] = decimal
				//arguments[2] = index of match
				let code = parseInt(arguments[1]);
				if (code > 0xffff)
					return String.fromCodePoint(code);
				else
					return String.fromCharCode(code);
			});
			req.body.emoji = req.body.emoji.replace(unicodeHexRegEx, function() {
				//arguments[0] = full unicode
				//arguments[1] = hex
				//arguments[2] = index of match
				let code = parseInt(arguments[1], 16);
				if (code > 0xffff)
					return String.fromCodePoint(code);
				else
					return String.fromCharCode(code);
			});
			emojiId = global.client.emojis.resolveIdentifier(req.body.emoji);
			if (emojiId)
				emojiId = decodeURIComponent(emojiId);
		} else {
			emjoiId = emoji.id;
		}
		if (!emojiId) {
			res.status(404).send({ error: 'Unknown emoji' });
		} else {
			if (req.body.exclusive) {
				if (req.message.author.id !== global.client.user.id) {
					res.status(403).send({ error: 'Cannot clear reactions on messages authored by other users' });
					next();
					return;
				}
				await req.message.reactions.removeAll();
				let reaction = await req.message.react(emojiId).catch((err) => {});
				if (!reaction) {
					res.status(500).send({ error: `Failed to add reaction` });
					next();
					return;
				}
			} else {
				let reaction = req.message.reactions.cache.get(emojiId);
				if (reaction && reaction.users.resolve(global.client.user.id)) {
					await reaction.users.remove(global.client.user.id).catch(() => {});
				} else {
					reaction = await req.message.react(emojiId).catch((err) => {});
					if (!reaction) {
						res.status(500).send({ error: `Failed to add reaction` });
						next();
						return;
					}
				}
			}
			res.send({ id: req.message.id });
		}
	}
	next();
});

messageRouter.get('/:message_id', (req, res, next) => {
	if (res.writableEnded) {
		//do nothing if response already sent
		next();
		return;
	}

	res.send({
		id: req.message.id,
		content: req.message.content,
		author: {
			name: req.message.author.tag,
			id: req.message.author.id,
		}
	});
	next();
});

messageRouter.put('/:message_id', (req, res, next) => {
	if (res.writableEnded) {
		//do nothing if response already sent
		next();
		return;
	}

	if (req.message.author.id !== global.client.user.id) {
		res.status(403).send({ error: 'Cannot edit messages authored by other users' });
	} else if (!req.body.content && !req.body.embeds) {
		res.status(400).send({ error: 'content or embeds must be provided' });
	} else {
		req.message.edit({
			content: req.body.content,
			embeds: req.body.embeds
		});
		res.send({ id: req.message.id });
	}
	next();
});

messageRouter.delete('/:message_id', async (req, res, next) => {
	if (res.writableEnded) {
		//do nothing if response already sent
		next();
		return;
	}

	if (req.message.author.id !== global.client.user.id) {
		res.status(403).send({ error: 'Cannot delete messages authored by other users' });
	} else {
		await req.message.delete().catch(() => {});
		res.send({ id: req.message.id });
	}
	next();
});

////////////////////////////
// channel router
////////////////////////////

const channelRouter = express.Router();
apiRouter.use('/channel', channelRouter);
apiRouter.use('/channels', channelRouter);
channelRouter.use('/:channel_id/message', messageRouter);
channelRouter.use('/:channel_id/messages', messageRouter);

function getChannel(guild, channel_id) {
	let channel = guild.channels.resolve(channel_id);
	if (!channel)
		channel = guild.channels.cache.find(c => c.name === channel_id);
	return channel;
}

//common channel_id processing
channelRouter.param('channel_id', (req, res, next, channel_id) => {
	if (res.writableEnded) {
		//do nothing if response already sent
		next();
		return;
	}

	let channel = getChannel(req.guild, channel_id);
	if (!channel) {
		res.status(404).send({ error: 'Unknown channel' });
	} else {
		req.channel = channel;
	}
	next();
});

function getChannelType(channel) {
	switch (channel.type) {
		case ChannelType.AnnouncementThread:
			return 'announcementThread';
		case ChannelType.DM:
			return 'dm';
		case ChannelType.GroupDM:
			return 'groupDM';
		case ChannelType.GuildAnnouncement:
			return 'announcement';
		case ChannelType.GuildCategory:
			return 'category';
		case ChannelType.GuildDirectory:
			return 'directory';
		case ChannelType.GuildForum:
			return 'forum';
		case ChannelType.GuildMedia:
			return 'media';
		case ChannelType.GuildNews:
			return 'news';
		case ChannelType.GuildNewsThread:
			return 'newsThread';
		case ChannelType.GuildPrivateThread:
			return 'privateThread';
		case ChannelType.GuildPublicThread:
			return 'publicThread';
		case ChannelType.GuildStageVoice:
			return 'stageVoice';
		case ChannelType.GuildText:
			return 'text';
		case ChannelType.GuildVoice:
			return 'voice';
		case ChannelType.PrivateThread:
			return 'privateThread';
		case ChannelType.PublicThread:
			return 'publicThread';
		default:
			return 'unknown';
	}
}
channelRouter.get('/:channel_id', async (req, res, next) => {
	if (res.writableEnded) {
		//do nothing if response already sent
		next();
		return;
	}

	let children = [];
	let category = req.channel.parent ?? req.channel;
	let officerRole;
	if (category) {
		//check if this category has an associated officer role
		let officerRoleName = category.name + ' ' + global.config.discordOfficerSuffix;
		officerRole = req.guild.roles.cache.find(r => { return r.name == officerRoleName; });
	}

	if (req.channel.children) {
		req.channel.children.cache.forEach(async function (c) {
			children.push({
				name: c.name,
				id: c.id,
				type: getChannelType(c),
				info: await global.getChannelInfo(req.guild, c, officerRole)
			});
		});
	}
	res.send({
		name: req.channel.name,
		id: req.channel.id,
		type: getChannelType(req.channel),
		info: await global.getChannelInfo(req.guild, req.channel, officerRole),
		children: children
	});

	next();
});

channelRouter.post('/:channel_id', async (req, res, next) => {
	if (res.writableEnded) {
		//do nothing if response already sent
		next();
		return;
	}

	if (!req.body.content && !req.body.embeds) {
		res.status(400).send({ error: 'content or embeds must be provided' });
	} else {
		let message = await req.channel.send({
			content: req.body.content,
			embeds: req.body.embeds
		}).catch((err) => { console.log(req.body);
			console.log(err); });
		if (message) {
			res.send({ id: message.id });
		} else {
			res.status(500).send({ error: 'Failed to send message' });
		}
	}
	next();
});

////////////////////////////
// role router
////////////////////////////

const roleRouter = express.Router();
apiRouter.use('/role', roleRouter);
apiRouter.use('/roles', roleRouter);

function getMember(guild, role_id) {
	let role = guild.roles.resolve(member_id);
	if (!role)
		member = guild.roles.cache.find(r => r.name === member_id);
	return member;
}

roleRouter.param('role_id', (req, res, next, role_id) => {
	if (res.writableEnded) {
		//do nothing if response already sent
		next();
		return;
	}

	let role = getRole(req.guild, role_id);
	if (!role) {
		res.status(404).send({ error: 'Unknown role' });
	} else {
		req.role = role;
	}
	next();
});

roleRouter.get('/export', async (req, res, next) => {
	if (res.writableEnded) {
		//do nothing if response already sent
		next();
		return;
	}

	let roles = [];
	req.guild.roles.cache.forEach(async (r) => {
		roles.push({
			id: r.id,
			name: r.name,
			color: r.color,
			icon: r.icon,
			hoist: r.hoist,
			permissions: r.permissions,
			position: r.position
		});
	});
	res.send(roles);
	next();
});


////////////////////////////
// member router
////////////////////////////

const memberRouter = express.Router();
apiRouter.use('/member', memberRouter);
apiRouter.use('/members', memberRouter);
memberRouter.use('/:member_id/message', messageRouter);
memberRouter.use('/:member_id/messages', messageRouter);

function getMember(guild, member_id) {
	let member = guild.members.resolve(member_id);
	if (!member)
		member = guild.members.cache.find(m => m.user.tag === member_id);
	return member;
}

//common member_id processing
memberRouter.param('member_id', (req, res, next, member_id) => {
	if (res.writableEnded) {
		//do nothing if response already sent
		next();
		return;
	}

	let member = getMember(req.guild, member_id);
	if (!member) {
		res.status(404).send({ error: 'Unknown member' });
	} else {
		req.member = member;
		req.channel = member.dmChannel;
	}
	next();
});

memberRouter.get('/:member_id', async (req, res, next) => {
	if (res.writableEnded) {
		//do nothing if response already sent
		next();
		return;
	}

	res.send({
		id: req.member.id,
		bot: req.member.bot,
		displayName: req.member.displayName,
		userName: req.member.user.username,
		tag: req.member.user.tag
	});
	next();
});

memberRouter.post('/:member_id', async (req, res, next) => {
	if (res.writableEnded) {
		//do nothing if response already sent
		next();
		return;
	}

	if (!req.body.content && !req.body.embeds) {
		res.status(400).send({ error: 'content or embeds must be provided' });
	} else {
		let message = await req.member.send({
			content: req.body.content,
			embeds: req.body.embeds
		}).catch(() => {});
		if (message) {
			res.send({ id: message.id });
		} else {
			res.status(500).send({ error: 'Failed to send message' });
		}
	}
	next();
});

////////////////////////////
// emoji router
////////////////////////////

const emojiRouter = express.Router();
apiRouter.use('/emoji', emojiRouter);

emojiRouter.get('/', async (req, res, next) => {
	if (res.writableEnded) {
		//do nothing if response already sent
		next();
		return;
	}

	let emojis = {};
	global.client.emojis.cache.forEach(function(emoji, id) {
		emojis[emoji.name] = {
			id: id,
			identifier: emoji.identifier,
			url: emoji.imageURL({ extension: "png" })
		};
	});
	res.send(emojis);
	next();
});

////////////////////////////
// Post processing
////////////////////////////

//respond 404 to unprocessed get request
apiRouter.get('*', (req, res, next) => {
	if (!res.writableEnded)
		res.status(404).send({ error: 'No endpoint' });
	next();
});

//respond 400 to all other unprocessed requests
apiRouter.all('*', (req, res, next) => {
	if (!res.writableEnded)
		res.status(400).send({ error: 'No endpoint' });
	next();
});

//log reqs
apiRouter.all('*', (req, res) => {
	if (req.reqMember)
		console.log(`API: [${req.client_ip} ${req.reqMember.user.tag}] ${res.statusCode} ${req.method} ${req.path}`);
	else
		console.log(`API: [${req.client_ip}] ${res.statusCode} ${req.method} ${req.path}`);
});

module.exports = {
	api: app
};
