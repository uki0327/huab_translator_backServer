# Docker 배포 가이드

## 사전 점검

배포 전에 Docker 설정을 점검하세요:

```bash
./docker_check.sh
```

## 빠른 시작

### 1. 환경 설정

`.env` 파일을 생성하세요 (`.env.example` 참고):

```bash
cp .env.example .env
nano .env  # 또는 다른 편집기로 편집
```

**필수 설정 항목:**
- `GOOGLE_API_KEY`: Google Cloud API 키
- `APP_TOKEN`: 클라이언트 인증 토큰

### 2. Docker Compose로 실행

```bash
# 빌드 및 시작
docker compose up -d

# 로그 확인
docker compose logs -f huab-translator-api

# 상태 확인
docker compose ps
```

### 3. 헬스체크

```bash
curl http://localhost:3000/healthz
# 응답: ok
```

## Docker 빌드 구조

### Dockerfile 분석

```dockerfile
FROM node:18-alpine          # ✓ 경량 Alpine 이미지 (약 180MB)
WORKDIR /app                 # ✓ 작업 디렉토리 설정

# 의존성 설치 (레이어 캐싱 최적화)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# 애플리케이션 복사
COPY index.js ./index.js     # ✓ 필요한 파일만 복사

# 보안: 비루트 사용자
USER app                      # ✓ 보안 모범 사례

# 실행
CMD ["node", "index.js"]
```

### 빌드 컨텍스트 최적화

**포함되는 파일들:**
```
server/
├── Dockerfile
├── package.json
├── package-lock.json (선택, 권장)
├── index.js
└── .dockerignore
```

**제외되는 파일들 (.dockerignore):**
- `node_modules/` - Docker 내에서 새로 설치
- `.env` - 환경변수는 docker-compose.yaml에서 주입
- `*.sqlite*` - 데이터는 볼륨으로 마운트
- `.git/` - 불필요한 Git 히스토리

### 볼륨 마운트

```yaml
volumes:
  - ./data:/app/data  # ✓ SQLite DB 영구 저장
```

**이점:**
- 컨테이너 재시작 시에도 데이터 유지
- 호스트에서 직접 백업 가능
- 컨테이너 삭제해도 데이터 보존

## 파일 전송 확인

### 1. 빌드 시 복사되는 파일

```bash
# 컨테이너 내부 확인
docker compose exec huab-translator-api ls -la /app
```

**예상 결과:**
```
drwxr-xr-x  app  app   /app
-rw-r--r--  app  app   index.js
-rw-r--r--  app  app   package.json
drwxr-xr-x  app  app   node_modules/
drwxr-xr-x  app  app   data/  (마운트된 볼륨)
```

### 2. 환경변수 확인

```bash
docker compose exec huab-translator-api env | grep -E "^(GOOGLE_API_KEY|APP_TOKEN|PORT|SQLITE_PATH)"
```

### 3. 데이터 볼륨 확인

```bash
# 호스트 측
ls -la ./data/

# 컨테이너 측
docker compose exec huab-translator-api ls -la /app/data/
```

**두 경로는 동일한 디렉토리를 가리킵니다.**

## 빌드 최적화

### package-lock.json 생성 (권장)

```bash
cd server
npm install  # package-lock.json 자동 생성
```

**이점:**
- 의존성 버전 고정 (재현 가능한 빌드)
- 빌드 속도 향상 (npm ci 사용 가능)
- 보안 취약점 추적 용이

### 레이어 캐싱 활용

Dockerfile은 이미 레이어 캐싱에 최적화되어 있습니다:

1. **의존성 레이어** (자주 변경 안 됨 → 캐시됨)
   ```dockerfile
   COPY package.json package-lock.json* ./
   RUN npm install --omit=dev
   ```

2. **애플리케이션 레이어** (자주 변경됨 → 재빌드)
   ```dockerfile
   COPY index.js ./index.js
   ```

**코드 수정 시**: 의존성 레이어는 캐시되어 빌드 시간 단축!

## 트러블슈팅

### 1. 빌드 실패: "Cannot find module 'express'"

**원인**: node_modules가 빌드되지 않음

**해결:**
```bash
docker compose build --no-cache
docker compose up -d
```

### 2. 데이터베이스 권한 오류

**원인**: 볼륨 마운트 권한 문제

**해결:**
```bash
chmod 755 ./data
docker compose restart
```

### 3. 환경변수가 로드되지 않음

**확인:**
```bash
# .env 파일 존재 여부
ls -la .env

# docker-compose.yaml에서 올바르게 참조하는지 확인
grep "GOOGLE_API_KEY" docker-compose.yaml
```

### 4. 이전 데이터베이스 버전 오류

서버가 자동으로 복구를 시도하지만, 수동 복구가 필요한 경우:

```bash
# 백업 확인
ls -la data/usage.backup-*.sqlite

# DB 삭제 후 재시작
rm -f data/usage.sqlite*
docker compose restart huab-translator-api
```

## 보안 고려사항

### ✓ 현재 구현된 보안 기능

1. **비루트 사용자 실행** (`USER app`)
2. **환경변수 분리** (API 키가 이미지에 포함되지 않음)
3. **최소 권한 원칙** (필요한 파일만 복사)
4. **데이터 격리** (볼륨 마운트로 분리)

### 추가 보안 권장사항

1. **프로덕션 환경**
   ```bash
   # 강력한 APP_TOKEN 생성
   openssl rand -base64 32
   ```

2. **HTTPS 프록시 사용**
   - Nginx 또는 Cloudflare 사용 권장
   - SSL/TLS 인증서 적용

3. **방화벽 설정**
   ```bash
   # 로컬 접근만 허용
   ports:
     - "127.0.0.1:3000:3000"
   ```

## 프로덕션 체크리스트

- [ ] `.env` 파일 생성 및 설정
- [ ] `GOOGLE_API_KEY` 설정
- [ ] `APP_TOKEN`을 강력한 값으로 변경
- [ ] `ALLOWED_ORIGINS` 설정 (특정 도메인만 허용)
- [ ] `SERVER_DOMAIN` 설정 (공개 도메인)
- [ ] `./data` 디렉토리 백업 설정
- [ ] 로그 모니터링 설정
- [ ] HTTPS 프록시 설정 (Nginx, Cloudflare 등)
- [ ] Docker 로그 로테이션 설정

## 모니터링

### 로그 확인

```bash
# 실시간 로그
docker compose logs -f huab-translator-api

# 최근 100줄
docker compose logs --tail=100 huab-translator-api

# 특정 시간 이후
docker compose logs --since 1h huab-translator-api
```

### 리소스 사용량

```bash
# 컨테이너 상태
docker compose ps

# 리소스 사용량
docker stats huab-translator-api
```

### 헬스체크 상태

```bash
docker inspect huab-translator-api --format='{{.State.Health.Status}}'
# 응답: healthy / unhealthy / starting
```

## 업데이트

```bash
# 1. 코드 업데이트
git pull

# 2. 재빌드
docker compose build

# 3. 재시작
docker compose up -d

# 4. 로그 확인
docker compose logs -f huab-translator-api
```

## 데이터 백업

```bash
# 수동 백업
cp data/usage.sqlite data/backup-$(date +%Y%m%d).sqlite

# 자동 백업 (cron)
0 3 * * * cp /path/to/data/usage.sqlite /path/to/backups/usage-$(date +\%Y\%m\%d).sqlite
```

## 참고사항

- **Node.js 버전**: 18-alpine (LTS)
- **컨테이너 크기**: 약 250MB (이미지 + 의존성)
- **메모리 사용량**: 약 50-100MB (유휴 상태)
- **빌드 시간**: 2-3분 (첫 빌드), 10-30초 (캐시 활용)
