FROM node:20-alpine
# git + docker-cli for CI/CD; python3 + make + g++ for node-pty native compile
RUN apk add --no-cache git docker-cli python3 make g++
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
# nodemon watches server.js — git pull on host = instant reload, no rebuild needed
CMD ["npx", "nodemon", "--watch", "server.js", "--watch", "public", "server.js"]
