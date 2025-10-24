# 🌐 Huab Translator Proxy Server

경량 **Node.js** 백엔드 서버로, **Google Translation API (v2)** 를 안전하게 프록시합니다.  
이를 통해 **Flutter 등 외부 앱이 Google API Key를 직접 노출하지 않고** 번역 기능을 사용할 수 있습니다.

---

## 🚀 주요 기능

- 🔒 **API Key 보호** — 서버에서만 Google Key 사용 (클라이언트 비노출)  
- 📊 **무료 사용량 관리** — 매월 50만자 무료(기본값), 자동 집계  
- 🧊 **자동 차단 기능** — 사용량이 96~98% 도달 시 “이번 달 무료 사용량을 모두 사용했습니다.” 응답  
- 🔁 **매월 1일 자동 리셋** (미국 태평양시 기준 → 한국시간 기준)  
  - 3월~10월: 1일 **오후 4시** 리셋  
  - 11월~2월: 1일 **오후 5시** 리셋  
- 🪶 **SQLite3 로컬 DB** — 외부 의존성 없이 자동 초기화  
- 🧱 **Docker 지원** — 단일 Compose 파일로 손쉬운 배포  

---

## 📁 폴더 구조
```
translate-proxy/
├── server/
│   ├── index.js
│   ├── package.json
│   ├── Dockerfile
│   └── env.example
├── data/                 # (자동 생성됨, SQLite 데이터 저장)
├── .env                  # (로컬 환경 설정, Git에 업로드 금지)
├── .gitignore
├── docker-compose.yaml
└── README.md
```
---

## ⚙️ 설치 방법

# 1. 저장소 클론
```bash
git clone https://github.com/wodykr/huab_translator_backServer.git
cd huab_translator_backServer
```
# 2. 환경 설정 파일 생성
```bash
cp server/env.example .env
```

# 3. 환경 변수 수정
```bash
nano .env
```

# 4. Docker Compose 실행
```bash
docker compose up -d
```

⸻

🧩 .env 설정 예시

변수명	설명
GOOGLE_API_KEY	Google Cloud Translation API 키
APP_TOKEN	앱 요청 인증용 고유 토큰 (Flutter 앱과 동일하게 설정)
PORT	서비스 포트 번호
FREE_TIER_LIMIT_CHARS	무료 번역 문자 수 한도
FREE_TIER_FREEZE_THRESHOLD_PCT	차단 임계 비율 (예: 98% 도달 시 차단)
SQLITE_PATH	SQLite DB 파일 경로

```env
GOOGLE_API_KEY=PUT_YOUR_KEY_HERE
APP_TOKEN=app-token-for-translate-secure
PORT=3000
FREE_TIER_LIMIT_CHARS=500000
FREE_TIER_FREEZE_THRESHOLD_PCT=98
SQLITE_PATH=/app/data/usage.sqlite
```

⸻

🧠 API 엔드포인트

메서드	경로	설명
GET	/healthz	서버 상태 확인 (ok 반환)
GET	/usage	월별 사용량 조회
POST	/translate	번역 요청 (X-App-Token 필요)


⸻

📤 예제 요청 (cURL)
```bash
curl -s -X POST https://translator.example.com/translate \
  -H "Content-Type: application/json" \
  -H "X-App-Token: app-token-for-translate-secure" \
  -d '{"text":"사랑해","source":"ko","target":"lo"}'
```

✅ 예제 응답
```json
{
  "translations": ["ຂ້ອຍຮັກເຈົ້າ"],
  "cached": false,
  "metered_chars": 3,
  "month_key": "2025-10-PT",
  "used_after": 12345,
  "limit": 500000
}
```

⸻

📊 사용량 조회 예시
```bash
curl -s https://translator.example.com/usage
```

```json
{
  "month_key": "2025-10-PT",
  "used": 12345,
  "limit": 500000,
  "remaining": 487655,
  "threshold_pct": 98,
  "frozen": false,
  "unit": "characters"
}
```

⸻

🧱 로컬 테스트 (Docker 없이)
```bash
cd server
npm install
node index.js
```

이후 브라우저에서 http://localhost:3000/healthz 접속

⸻

⚠️ 주의사항
	•	.env, data/usage.sqlite 는 절대 Git에 업로드 금지
	•	서버를 퍼블릭에 노출 시 반드시 APP_TOKEN을 복잡한 문자열로 변경
	•	DSM, Nginx, Cloudflare 등으로 HTTPS 역프록시 (예: translator.example.com) 구성 권장
	•	DB 파일(data/)은 chmod 700 이상 권한으로 설정

⸻

🪪 라이선스

MIT License © 2025 Wody
자유롭게 수정 및 배포 가능. 단, Google API Key는 개인 소유로 유지하세요.
