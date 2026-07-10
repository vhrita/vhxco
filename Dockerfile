FROM node:22-alpine AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Build-time public env vars (Astro/Vite inlines PUBLIC_* at build time)
ARG PUBLIC_FORMSPREE_ID
ENV PUBLIC_FORMSPREE_ID=$PUBLIC_FORMSPREE_ID
ARG PUBLIC_POSTHOG_KEY
ENV PUBLIC_POSTHOG_KEY=$PUBLIC_POSTHOG_KEY
ARG PUBLIC_POSTHOG_HOST
ENV PUBLIC_POSTHOG_HOST=$PUBLIC_POSTHOG_HOST

RUN pnpm run build

FROM nginx:alpine AS runtime

COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]