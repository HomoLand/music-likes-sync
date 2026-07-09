FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4319

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY web ./web

RUN mkdir -p /app/data /app/reports
VOLUME ["/app/data", "/app/reports"]

EXPOSE 4319
CMD ["node", "src/server.js"]
