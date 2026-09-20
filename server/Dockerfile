FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma
RUN npm install
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma
RUN npm install --omit=dev && npx prisma generate
COPY --from=build /app/dist ./dist
# Застосувати зміни схеми та стартувати.
# Без --accept-data-loss: деструктивна зміна схеми впаде з помилкою,
# а не зітре дані мовчки. Деплой робить pg_dump перед оновленням.
CMD ["sh", "-c", "npx prisma db push && node dist/index.js"]
