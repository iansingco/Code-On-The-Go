FROM node:20-alpine
RUN apk add --no-cache git docker-cli
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY . .
CMD ["node", "server.js"]
