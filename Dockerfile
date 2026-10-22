FROM node:20-alpine
USER node
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 8066
CMD node server.js -d /data/ -o "$DNC_US_ORIGINS" --mattermost $MM_URL -w $MM_TEAM -t $MM_TOKEN --mempool $DNC_US_MEMPOOL_API
