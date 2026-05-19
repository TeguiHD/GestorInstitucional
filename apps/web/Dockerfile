##########################################################################
# Stage 1: deps + build
##########################################################################
FROM node:22-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm@9

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile

COPY . .

ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN pnpm --filter @asistencia/shared run build
RUN pnpm --filter @asistencia/web run build

##########################################################################
# Stage 2: nginx static server
##########################################################################
FROM nginx:1.27-alpine AS runner

COPY infra/nginx/spa.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

RUN chown -R nginx:nginx /usr/share/nginx/html && chmod -R 755 /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
