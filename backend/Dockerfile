FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache python3 py3-pip apache2-utils \
    && pip3 install --break-system-packages radicale bcrypt

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY radicale/ ./radicale/
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

RUN mkdir -p /app/radicale/data /app/data

CMD ["./entrypoint.sh"]
