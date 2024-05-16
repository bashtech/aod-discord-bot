FROM node:lts

# Copy bot
COPY ./aod-discord-bot.js /app/aod-discord-bot.js
COPY ./api /app/api
COPY ./commands /app/commands

# Copy NPM requirements
COPY ./package.json /app/package.json
COPY ./package-lock.json /app/package-lock.json

WORKDIR /app

# Generate self-signed cert
RUN mkdir -p /app/cert
RUN openssl req -x509 -nodes -days 365 \
    -subj  "/O=ClanAOD/CN=discord.clanaod.lcl" \
     -newkey rsa:2048 -keyout /app/cert/key.pem \
     -out /app/cert/cert.crt

# Install dependencies
RUN npm install

CMD ["node", "aod-discord-bot.js"]
EXPOSE 4443