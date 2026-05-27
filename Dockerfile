FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4319

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY web ./web

# The local dev server binds to 127.0.0.1. In Kubernetes it must listen on the
# pod interface so a Service can reach it.
RUN node -e "const fs=require('node:fs');const p='src/server.js';let s=fs.readFileSync(p,'utf8');const from=\"server.listen(PORT, '127.0.0.1', () => {\";const to=\"server.listen(PORT, process.env.HOST || '0.0.0.0', () => {\";if(!s.includes(from)) throw new Error('server listen host pattern not found');fs.writeFileSync(p,s.replace(from,to));"

RUN mkdir -p /app/data /app/reports
VOLUME ["/app/data", "/app/reports"]

EXPOSE 4319
CMD ["node", "src/server.js"]
