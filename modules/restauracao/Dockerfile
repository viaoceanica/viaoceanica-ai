FROM node:20-alpine

WORKDIR /app

RUN npm init -y >/dev/null 2>&1 \
  && npm install --omit=dev express cors >/dev/null 2>&1

COPY dist ./dist
COPY src ./src

EXPOSE 4001

CMD ["node", "dist/index.js"]
