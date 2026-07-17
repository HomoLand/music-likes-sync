FROM node:24-alpine AS web-build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY web-app ./web-app
RUN npm run check:web-app

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4319

COPY package.json package-lock.json ./
RUN apk add --no-cache ffmpeg
RUN npm ci --omit=dev

COPY src ./src
COPY web ./web
COPY --from=web-build /app/web-app/dist ./web-app/dist

RUN mkdir -p /app/data /app/reports
VOLUME ["/app/data", "/app/reports"]

EXPOSE 4319
CMD ["node", "src/server.js"]
