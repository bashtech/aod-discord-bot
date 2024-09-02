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


function logRequest() {
	let src = this.client_ip;
	if (this.reqMember)
		src = src + ' ' + this.reqMember.user.tag;
	console.log(`API: [${src}] ${this.res.statusCode} ${this.method} ${this.baseUrl}${this.path} ${this.res.statusMessage}`);
}

//WARNING: handlers are processed in the order of definition

//register log callback; Must be first middleware
app.use(function(req, res, next) {
	req.on('end', logRequest);
	next();
});

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
				return next();
			}
		}
	}
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
		return res.status(503).send({ error: 'Discord client not ready' });
	} else {
		req.guild = global.client.guilds.resolve(config.guildId);
	}
	let requested_by_hdr = req.get('X-Requested-By');
	if (requested_by_hdr) {
		//FIXME: should this be required?
		req.reqMember = getMember(req.guild, requested_by_hdr);
		if (!req.reqMember) {
			return res.status(400).send({ error: 'Unknown requestor' });
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
	if (!req.channel) {
		return res.status(404).send({ error: 'No channel' });
	} else if (!req.channel.isTextBased()) {
		return res.status(400).send({ error: 'Channel must be text based' });
	} else {
		let message = await req.channel.messages.fetch(message_id).catch(() => {});
		if (!message) {
			return res.status(404).send({ error: 'Unknown message' });
		} else {
			req.message = message;
		}
	}
	next();
});

const unicodeRegEx = /&#([0-9]+);/g; //BE CAREFUL OF CAPTURE GROUPS BELOW
const unicodeHexRegEx = /&#x([0-9a-fA-F]+);/g; //BE CAREFUL OF CAPTURE GROUPS BELOW
messageRouter.post('/:message_id/react', async (req, res, next) => {
	let emjoiId;
	if (!req.body.emoji) {
		return res.status(400).send({ error: 'emoji must be provided' });
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
			return res.status(404).send({ error: 'Unknown emoji' });
		} else {
			if (req.body.exclusive) {
				if (req.message.author.id !== global.client.user.id) {
					return res.status(403).send({ error: 'Cannot clear reactions on messages authored by other users' });
				}
				await req.message.reactions.removeAll();
				let reaction = await req.message.react(emojiId).catch((err) => {});
				if (!reaction) {
					return res.status(500).send({ error: `Failed to add reaction` });
				}
			} else {
				let reaction = req.message.reactions.cache.get(emojiId);
				if (reaction && reaction.users.resolve(global.client.user.id)) {
					await reaction.users.remove(global.client.user.id).catch(() => {});
				} else {
					reaction = await req.message.react(emojiId).catch((err) => {});
					if (!reaction) {
						return res.status(500).send({ error: `Failed to add reaction` });
					}
				}
			}
			return res.send({ id: req.message.id });
		}
	}
});

messageRouter.get('/:message_id', (req, res, next) => {
	return res.send({
		id: req.message.id,
		content: req.message.content,
		author: {
			name: req.message.author.tag,
			id: req.message.author.id,
		}
	});
});

messageRouter.put('/:message_id', (req, res, next) => {

	if (req.message.author.id !== global.client.user.id) {
		return res.status(403).send({ error: 'Cannot edit messages authored by other users' });
	} else if (!req.body.content && !req.body.embeds) {
		return res.status(400).send({ error: 'content or embeds must be provided' });
	} else {
		req.message.edit({
			content: req.body.content,
			embeds: req.body.embeds
		});
		return res.send({ id: req.message.id });
	}
});

messageRouter.delete('/:message_id', async (req, res, next) => {
	if (req.message.author.id !== global.client.user.id) {
		return res.status(403).send({ error: 'Cannot delete messages authored by other users' });
	} else {
		await req.message.delete().catch(() => {});
		return res.send({ id: req.message.id });
	}
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
	let channel = getChannel(req.guild, channel_id);
	if (!channel) {
		return res.status(404).send({ error: 'Unknown channel' });
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
	let children = [];
	let category = req.channel.parent ?? req.channel;
	let officerRole;
	if (category) {
		//check if this category has an associated officer role
		let officerRoleName = category.name + ' ' + global.config.discordOfficerSuffix;
		officerRole = req.guild.roles.cache.find(r => { return r.name == officerRoleName; });
	}

	if (req.channel.children) {
		req.channel.children.cache.forEach(async function(c) {
			children.push({
				name: c.name,
				id: c.id,
				type: getChannelType(c),
				info: await global.getChannelInfo(req.guild, c, officerRole)
			});
		});
	}
	return res.send({
		name: req.channel.name,
		id: req.channel.id,
		type: getChannelType(req.channel),
		info: await global.getChannelInfo(req.guild, req.channel, officerRole),
		children: children
	});
});

channelRouter.post('/:channel_id', async (req, res, next) => {
	if (!req.body.content && !req.body.embeds) {
		return res.status(400).send({ error: 'content or embeds must be provided' });
	} else {
		let message = await req.channel.send({
			content: req.body.content,
			embeds: req.body.embeds
		}).catch((err) => {
			console.log(err);
		});
		if (message) {
			return res.send({ id: message.id });
		} else {
			return res.status(500).send({ error: 'Failed to send message' });
		}
	}
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
	let role = getRole(req.guild, role_id);
	if (!role) {
		return res.status(404).send({ error: 'Unknown role' });
	} else {
		req.role = role;
	}
	next();
});

roleRouter.get('/export', async (req, res, next) => {
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
	return res.send(roles);
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
	let member = getMember(req.guild, member_id);
	if (!member) {
		return res.status(404).send({ error: 'Unknown member' });
	} else {
		req.member = member;
		req.channel = member.dmChannel;
	}
	next();
});

memberRouter.get('/:member_id', async (req, res, next) => {
	return res.send({
		id: req.member.id,
		bot: req.member.bot,
		displayName: req.member.displayName,
		userName: req.member.user.username,
		tag: req.member.user.tag
	});
});

memberRouter.get('/:member_id/update', async (req, res, next) => {
	global.setRolesForMember(req.guild, req.member, `Requested by ${req.reqMember ?? 'API'}`)
		.then((roles) => res.send({
			id: req.member.id,
			roles: roles.map(r => { return { id: r.id, name: r.name }; })
		}))
		.catch(() => res.status(500).send({ error: 'Failed to run member update' }));
});

memberRouter.post('/:member_id', async (req, res, next) => {
	if (!req.body.content && !req.body.embeds) {
		return res.status(400).send({ error: 'content or embeds must be provided' });
	} else {
		let message = await req.member.send({
			content: req.body.content,
			embeds: req.body.embeds
		}).catch(() => {});
		if (message) {
			return res.send({ id: message.id });
		} else {
			return res.status(500).send({ error: 'Failed to send message' });
		}
	}
});

////////////////////////////
// forum member router
////////////////////////////

const forumMemberRouter = express.Router();
apiRouter.use('/forum_member', forumMemberRouter);
apiRouter.use('/forum_members', forumMemberRouter);

//common forum_id processing
forumMemberRouter.param('forum_id', async (req, res, next, forum_id) => {
	let forumInfo = await global.getForumInfoForMember(forum_id);
	if (!forumInfo) {
		return res.status(404).send({ error: 'Unknown forum member' });
	} else {
		req.forumInfo = forumInfo;
	}
	next();
});

forumMemberRouter.get('/:forum_id', async (req, res, next) => {
	return res.send(req.forumInfo);
});

////////////////////////////
// emoji router
////////////////////////////

const emojiRouter = express.Router();
apiRouter.use('/emoji', emojiRouter);

emojiRouter.get('/', async (req, res, next) => {
	let emojis = {};
	global.client.emojis.cache.forEach(function(emoji, id) {
		emojis[emoji.name] = {
			id: id,
			identifier: emoji.identifier,
			url: emoji.imageURL({ extension: "png" })
		};
	});
	return res.send(emojis);
});

////////////////////////////
// Post processing
////////////////////////////

//respond 404 to unprocessed get request
apiRouter.get('*', (req, res, next) => {
	return res.status(404).send({ error: 'No endpoint' });
});

//respond 400 to all other unprocessed requests
apiRouter.all('*', (req, res, next) => {
	return res.status(400).send({ error: 'No endpoint' });
});

module.exports = {
	api: app
};
