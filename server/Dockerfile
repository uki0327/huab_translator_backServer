# Google Cloud API Proxy Server (Translation v2 & Text-to-Speech v1)
FROM node:18-alpine

# 작업 디렉토리 설정
WORKDIR /app

# 의존성 파일 복사 및 설치
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# 애플리케이션 소스 복사
COPY index.js ./index.js

# 보안: 비루트 사용자로 실행
RUN addgroup -S app && adduser -S app -G app && \
    chown -R app:app /app
USER app

# 포트 노출
EXPOSE 3000

# 애플리케이션 실행
CMD ["node", "index.js"]
