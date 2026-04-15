FROM node:22-alpine AS builder
WORKDIR /app

# Copy everything from project root (build context is .)
COPY package.json pnpm-lock.yaml* ./
COPY client/ ./client/
COPY shared/ ./shared/
COPY shell/vite.config.ts ./shell/vite.config.ts
COPY tsconfig.json ./

# Install deps with legacy peer deps to avoid conflicts with Manus-specific plugins
RUN npm install --legacy-peer-deps

# Build frontend using the production vite config (no Manus plugins)
RUN npx vite build --config shell/vite.config.ts

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY shell/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3001
CMD ["nginx", "-g", "daemon off;"]
