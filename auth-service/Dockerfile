FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm install --omit=dev && npm install prisma
COPY dist ./dist
COPY public ./public
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/server.js"]
