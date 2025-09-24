# Build stage
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM socialengine/nginx-spa:latest

COPY --from=build /app/dist /app

RUN chmod -R 755 /app

EXPOSE 80