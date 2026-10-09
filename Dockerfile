FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
ENV NODE_ENV=production
EXPOSE 3001
CMD ["bun", "run", "server/index.ts"]
