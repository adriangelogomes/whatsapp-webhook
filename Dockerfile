FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci --only=production

COPY . .

EXPOSE 3000

RUN addgroup -S app && adduser -S app -G app
USER app

CMD ["node", "index.js"]

