FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies before copying the application for better layer caching.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# Back4App injects PORT at runtime; the app also defaults to 3000.
EXPOSE 3000

CMD ["npm", "start"]
