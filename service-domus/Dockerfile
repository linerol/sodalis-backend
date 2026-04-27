FROM node:22-alpine
WORKDIR /app
COPY service-domus/package*.json ./
RUN npm ci --omit=dev
COPY service-domus/ ./
COPY shared/ /shared/
EXPOSE 3001
CMD ["node", "index.js"]
