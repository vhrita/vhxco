FROM node:20-alpine AS build

WORKDIR /app

# Enable corepack and install pnpm
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM socialengine/nginx-spa:latest

COPY --from=build /app/dist /app

RUN chmod -R 755 /app

EXPOSE 80