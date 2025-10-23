FROM node:18-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY index.js ./index.js

# 비루트 실행
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000
CMD ["node", "index.js"]
