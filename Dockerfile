# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

# Initialize empty DB if needed (or expect volume mount at /app/data)
# But for now, app writes to ./dapi.db relative to CWD.
# Better to use VOLUME /app/data and update config to use that path.

EXPOSE 3001

CMD ["npm", "start"]
