FROM node:20-alpine

# git is needed for the webhook CI/CD pull
RUN apk add --no-cache git docker-cli

WORKDIR /app
COPY package.json .
RUN npm install --production
COPY . .

CMD ["node", "server.js"]
