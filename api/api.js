/* jshint esversion: 11 */

const express = require('express');
const app = express();

app.disable('x-powered-by');

//parse application/json input data
app.use(express.json());

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

const api = express.Router();
app.use('/api', api);

//ensure discord is ready before calling any APIs
api.all('*', (req, res, next) => {
	if (!global.client || !global.client.isReady()) {
		res.status(503).send({ error: 'Discord client not ready' });
	} else {
		req.guild = global.client.guilds.resolve(config.guildId);
	}
	next();
});

////////////////////////////
// channel router
////////////////////////////

const channel = express.Router();
api.use('/channel', channel);

function getChannel(guild, channel_id) {
	let channel = guild.channels.resolve(channel_id);
	if (!channel)
		channel = guild.channels.cache.find(c => c.name === channel_id);
	return channel;
}

//common channel_id processing
channel.param('channel_id', (req, res, next, channel_id) => {
	let channel = getChannel(req.guild, channel_id);
	if (!channel) {
		res.status(400).send({ error: 'Unknown channel' });
	} else if (!channel.isTextBased()) {
		res.status(400).send({ error: 'Channel must be text based' });
	} else {
		req.channel = channel;
	}
	next();
});

//common message_id processing
channel.param('message_id', async (req, res, next, message_id) => {
	let message = await req.channel.messages.fetch(message_id).catch(() => {});
	if (!message) {
		res.status(400).send({ error: 'Unknown message' });
	} else {
		req.message = message;
	}
	next();
});

const unicodeRegEx = /&#([0-9]+);/g; //BE CAREFUL OF CAPTURE GROUPS BELOW
channel.post('/:channel_id/message/:message_id/react', async (req, res, next) => {
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
			let emojiId = global.client.emojis.resolveIdentifier(req.body.emoji) ?? '';
			emoji = decodeURI(emojiId);
		}
		if (!emoji) {
			res.status(400).send({ error: 'Unknown emoji' });
		} else {
			let reaction = req.message.reactions.cache.get(emoji.id);
			if (req.body.exclusive) {
				if (req.message.author.id !== global.client.user.id) {
					res.status(403).send({ error: 'Cannot clear reactions on messages authored by other users' });
					next();
					return;
				}
				await req.message.reactions.removeAll();
			} else if (reaction && reaction.users.resolve(global.client.user.id)) {
				await reaction.users.remove(global.client.user.id);
			} else {
				reaction = await req.message.react(emoji).catch(() => {});
				if (!reaction) {
					res.status(500).send({ error: `Failed to add reaction` });
					next();
					return;
				}
			}
			res.send({ id: req.message.id });
		}
	}
	next();
});

channel.get('/:channel_id/message/:message_id', (req, res, next) => {
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

channel.post('/:channel_id/message/:message_id', (req, res, next) => {
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

channel.delete('/:channel_id/message/:message_id', async (req, res, next) => {
	if (req.message.author.id !== global.client.user.id) {
		res.status(403).send({ error: 'Cannot delete messages authored by other users' });
	} else {
		await req.message.delete().catch(() => {});
		res.send({ id: req.message.id });
	}
	next();
});

channel.post('/:channel_id', async (req, res, next) => {
	if (!req.body.content && !req.body.embeds) {
		res.status(400).send({ error: 'content or embeds must be provided' });
	} else {
		let message = await req.channel.send({
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

const emoji = express.Router();
api.use('/emoji', emoji);

emoji.get('/', async (req, res, next) => {
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
api.get('*', (req, res, next) => {
	if (!res.writableEnded)
		res.status(404).send({ error: 'No endpoint' });
	next();
});

//respond 400 to all other unprocessed requests
api.all('*', (req, res, next) => {
	if (!res.writableEnded)
		res.status(400).send({ error: 'No endpoint' });
	next();
});

//log reqs
api.all('*', (req, res) => {
	console.log(`API: [${req.client_ip}] ${res.statusCode} ${req.method} ${req.path}`);
});

module.exports = {
	api: app
};
