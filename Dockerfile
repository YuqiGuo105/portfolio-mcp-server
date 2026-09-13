FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY web/ ./web/
COPY scripts/build-workspace.mjs ./scripts/build-workspace.mjs
COPY plugins/yuqi-portfolio/assets/ ./plugins/yuqi-portfolio/assets/
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY --from=build /app/dist/ ./dist/
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "src/index.js"]
