FROM node:22-alpine
WORKDIR /app
COPY service-labor/package*.json ./
RUN npm ci --omit=dev
COPY service-labor/ ./
COPY shared/ /shared/
EXPOSE 3002
CMD ["node", "index.js"]
