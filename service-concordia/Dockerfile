FROM node:22-alpine
WORKDIR /app
COPY service-concordia/package*.json ./
RUN npm ci --omit=dev
COPY service-concordia/ ./
EXPOSE 3003
CMD ["node", "index.js"]
