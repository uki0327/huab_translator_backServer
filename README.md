# 🌐 Huab Translator Proxy Server

경량 **Node.js** 백엔드 서버로, **Google Cloud API (Translation v2 & Text-to-Speech v1)** 를 안전하게 프록시합니다.
이를 통해 **Flutter 등 외부 앱이 Google API Key를 직접 노출하지 않고** 번역 및 음성합성 기능을 사용할 수 있습니다.

---

## 🚀 주요 기능

- 🔒 **API Key 보호** — 서버에서만 Google Key 사용 (클라이언트 비노출)
- 🌐 **번역 API (Translation v2)** — 100개 이상 언어 번역 지원
- 🔊 **음성합성 API (Text-to-Speech v1)** — 텍스트를 음성으로 변환 (MP3, OGG 등 지원)
- 📊 **개별 사용량 관리** — Translation과 TTS 각각 독립적인 quota 관리
  - **Translation**: 월 **50만 문자** 무료
  - **TTS (Standard)**: 월 **400만 문자** 무료
- 🧊 **자동 차단 기능** — 각 API별 사용량이 98% 도달 시 자동 차단
- 🔁 **매월 1일 자동 리셋** (미국 태평양시 기준)
  - 3월~10월: 1일 **오후 4시** 리셋 (한국시간)
  - 11월~2월: 1일 **오후 5시** 리셋 (한국시간)
- 🪶 **SQLite3 로컬 DB** — 외부 의존성 없이 자동 초기화
- 🔄 **자동 마이그레이션** — 데이터 손실 없이 버전 업그레이드
- 🧱 **Docker 지원** — 단일 Compose 파일로 손쉬운 배포

---

## 📁 폴더 구조
```
huab_translator_backServer/
├── server/
│   ├── index.js          # 메인 서버 로직 (Translation & TTS)
│   ├── package.json      # v2.1.0
│   ├── Dockerfile
│   └── env.example
├── data/                 # (자동 생성됨, SQLite 데이터 저장)
├── .env                  # (로컬 환경 설정, Git에 업로드 금지)
├── docker-compose.yaml
├── CLAUDE.md             # Claude Code용 개발 가이드
├── MIGRATIONS.md         # 데이터베이스 마이그레이션 가이드
└── README.md
```

---

## ⚙️ 설치 방법

### 1. 저장소 클론
```bash
git clone https://github.com/wodykr/huab_translator_backServer.git
cd huab_translator_backServer
```

### 2. 환경 설정 파일 생성
```bash
cp server/env.example .env
```

### 3. 환경 변수 수정
```bash
nano .env
```

**.env 파일 예시:**
```env
# Google Cloud API Key (Translation & TTS 공통)
GOOGLE_API_KEY=PUT_YOUR_KEY_HERE

# 앱 인증 토큰
APP_TOKEN=app-token-for-translate-secure

# 서버 포트
PORT=3000

# Translation API 무료 한도 (Google: 월 50만 문자)
TRANSLATE_FREE_TIER_CHARS=500000
TRANSLATE_FREEZE_THRESHOLD_PCT=98

# TTS API 무료 한도 (Google Standard: 월 400만 문자)
TTS_FREE_TIER_CHARS=4000000
TTS_FREEZE_THRESHOLD_PCT=98

# SQLite DB 경로
SQLITE_PATH=/app/data/usage.sqlite
```

### 4. Docker Compose 실행
```bash
docker compose up -d
```

### 5. 서버 상태 확인
```bash
curl http://localhost:3000/healthz
# 응답: ok
```

---

## 🧩 환경 변수 상세 설명

| 변수명 | 설명 | 기본값 | 필수 |
|--------|------|--------|------|
| `GOOGLE_API_KEY` | Google Cloud API 키 (Translation & TTS 공통) | - | ✅ |
| `APP_TOKEN` | API 요청 인증용 토큰 (X-App-Token 헤더) | - | ✅ |
| `PORT` | 서버 포트 번호 | 3000 | ❌ |
| `TRANSLATE_FREE_TIER_CHARS` | Translation 월별 무료 한도 | 500000 | ❌ |
| `TRANSLATE_FREEZE_THRESHOLD_PCT` | Translation 차단 임계 비율 | 98 | ❌ |
| `TTS_FREE_TIER_CHARS` | TTS 월별 무료 한도 (Standard voices) | 4000000 | ❌ |
| `TTS_FREEZE_THRESHOLD_PCT` | TTS 차단 임계 비율 | 98 | ❌ |
| `SQLITE_PATH` | SQLite DB 파일 경로 | /app/data/usage.sqlite | ❌ |

**참고:**
- Translation과 TTS는 **별도 quota**로 관리됩니다
- Translation이 차단되어도 TTS는 계속 사용 가능 (반대도 동일)

---

## 🧠 API 엔드포인트

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| `GET` | `/healthz` | 서버 상태 확인 | 불필요 |
| `GET` | `/usage` | 월별 사용량 조회 (API별) | 불필요 |
| `POST` | `/translate` | 텍스트 번역 | X-App-Token 필요 |
| `POST` | `/tts` | 텍스트 음성 변환 | X-App-Token 필요 |

---

## 📊 사용량 조회 API

### 요청
```bash
GET /usage
```

### 응답 예시
```json
{
  "month_key": "2025-10-PT",
  "translation": {
    "used": 12345,
    "limit": 500000,
    "remaining": 487655,
    "threshold_pct": 98,
    "frozen": false,
    "unit": "characters"
  },
  "tts": {
    "used": 50000,
    "limit": 4000000,
    "remaining": 3950000,
    "threshold_pct": 98,
    "frozen": false,
    "unit": "characters"
  }
}
```

### 응답 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `month_key` | string | PST 기준 월 키 (예: `2025-10-PT`) |
| `translation.used` | number | Translation API 사용 문자 수 |
| `translation.limit` | number | Translation 월별 한도 |
| `translation.remaining` | number | Translation 남은 문자 수 |
| `translation.frozen` | boolean | Translation 차단 여부 |
| `tts.used` | number | TTS API 사용 문자 수 |
| `tts.limit` | number | TTS 월별 한도 |
| `tts.remaining` | number | TTS 남은 문자 수 |
| `tts.frozen` | boolean | TTS 차단 여부 |

---

## 📤 번역 API (Translation)

### 요청

**엔드포인트:** `POST /translate`

**헤더:**
```
Content-Type: application/json
X-App-Token: your-app-token-here
```

**Body 파라미터:**

| 파라미터 | 타입 | 필수 | 설명 | 기본값 |
|----------|------|------|------|--------|
| `text` | string \| string[] | ✅ | 번역할 텍스트 (배열 가능) | - |
| `source` | string | ❌ | 원본 언어 코드 (예: `ko`, `en`) | `ko` |
| `target` | string | ❌ | 목표 언어 코드 (예: `lo`, `ja`) | `lo` |

**지원 언어 코드:**
- `ko`: 한국어
- `en`: 영어
- `ja`: 일본어
- `zh`: 중국어
- `lo`: 라오어
- `th`: 태국어
- 기타 100개 이상 언어 지원

### 요청 예시

#### 단일 텍스트 번역
```bash
curl -X POST https://translator.example.com/translate \
  -H "Content-Type: application/json" \
  -H "X-App-Token: app-token-for-translate-secure" \
  -d '{
    "text": "사랑해",
    "source": "ko",
    "target": "lo"
  }'
```

#### 배치 번역 (여러 텍스트)
```bash
curl -X POST https://translator.example.com/translate \
  -H "Content-Type: application/json" \
  -H "X-App-Token: app-token-for-translate-secure" \
  -d '{
    "text": ["안녕하세요", "감사합니다", "사랑해요"],
    "source": "ko",
    "target": "en"
  }'
```

### 응답

#### 성공 응답 (200 OK)
```json
{
  "translations": ["ຂ້ອຍຮັກເຈົ້າ"],
  "cached": false,
  "metered_chars": 3,
  "month_key": "2025-10-PT",
  "api_type": "translation",
  "used_after": 12348,
  "limit": 500000
}
```

#### 배치 번역 응답
```json
{
  "translations": [
    "Hello",
    "Thank you",
    "I love you"
  ],
  "cached": false,
  "metered_chars": 18,
  "month_key": "2025-10-PT",
  "api_type": "translation",
  "used_after": 12366,
  "limit": 500000
}
```

#### 에러 응답 (429 Too Many Requests)
```json
{
  "error": "🇰🇷 이번 달 번역 무료 사용량을 모두 사용했습니다.\n🇱🇦 ຂ້ອຍໄດ້ໃຊ້ປະລິມານການແປພາສາຟຣີຂອງເດືອນນີ້ໝົດແລ້ວ.",
  "code": "TRANSLATION_FREE_TIER_EXHAUSTED",
  "api_type": "translation"
}
```

### 응답 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `translations` | string[] | 번역된 텍스트 배열 |
| `cached` | boolean | 캐시 사용 여부 (현재는 항상 false) |
| `metered_chars` | number | 이번 요청에서 사용된 문자 수 |
| `month_key` | string | 현재 월 키 (PST 기준) |
| `api_type` | string | API 타입 (`translation`) |
| `used_after` | number | 요청 후 누적 사용량 |
| `limit` | number | 월별 한도 |

---

## 🔊 음성합성 API (Text-to-Speech)

### 요청

**엔드포인트:** `POST /tts`

**헤더:**
```
Content-Type: application/json
X-App-Token: your-app-token-here
```

**Body 파라미터:**

| 파라미터 | 타입 | 필수 | 설명 | 기본값 |
|----------|------|------|------|--------|
| `text` | string | ✅ | 음성으로 변환할 텍스트 | - |
| `languageCode` | string | ❌ | 언어 코드 (예: `ko-KR`, `en-US`) | `ko-KR` |
| `voiceName` | string | ❌ | 특정 음성 이름 (예: `ko-KR-Standard-A`) | 자동 선택 |
| `ssmlGender` | string | ❌ | 음성 성별 (`NEUTRAL`, `MALE`, `FEMALE`) | `NEUTRAL` |
| `audioEncoding` | string | ❌ | 오디오 포맷 | `MP3` |
| `speakingRate` | number | ❌ | 말하기 속도 (0.25 ~ 4.0) | `1.0` |
| `pitch` | number | ❌ | 음높이 (-20.0 ~ 20.0) | `0.0` |
| `volumeGainDb` | number | ❌ | 볼륨 게인 (-96.0 ~ 16.0) | `0.0` |

### 오디오 인코딩 옵션

| 값 | 설명 | 확장자 |
|----|------|--------|
| `MP3` | MP3 오디오 (압축) | .mp3 |
| `LINEAR16` | WAV 오디오 (무손실) | .wav |
| `OGG_OPUS` | OGG Opus (압축) | .ogg |
| `MULAW` | 8-bit PCM mu-law | .wav |
| `ALAW` | 8-bit PCM A-law | .wav |

### 언어 코드 예시

| 언어 | 코드 | 사용 가능한 음성 예시 |
|------|------|----------------------|
| 한국어 | `ko-KR` | `ko-KR-Standard-A`, `ko-KR-Standard-B` |
| 영어(미국) | `en-US` | `en-US-Standard-A`, `en-US-Wavenet-A` |
| 일본어 | `ja-JP` | `ja-JP-Standard-A`, `ja-JP-Wavenet-A` |
| 중국어 | `zh-CN` | `zh-CN-Standard-A` |
| 태국어 | `th-TH` | `th-TH-Standard-A` |

### 요청 예시

#### 기본 음성 합성 (한국어)
```bash
curl -X POST https://translator.example.com/tts \
  -H "Content-Type: application/json" \
  -H "X-App-Token: app-token-for-translate-secure" \
  -d '{
    "text": "안녕하세요. 반갑습니다."
  }'
```

#### 영어 음성 합성
```bash
curl -X POST https://translator.example.com/tts \
  -H "Content-Type: application/json" \
  -H "X-App-Token: app-token-for-translate-secure" \
  -d '{
    "text": "Hello, how are you?",
    "languageCode": "en-US",
    "ssmlGender": "FEMALE"
  }'
```

#### 고급 설정 (속도, 음높이 조절)
```bash
curl -X POST https://translator.example.com/tts \
  -H "Content-Type: application/json" \
  -H "X-App-Token: app-token-for-translate-secure" \
  -d '{
    "text": "빠르게 말하는 테스트입니다",
    "languageCode": "ko-KR",
    "voiceName": "ko-KR-Standard-A",
    "audioEncoding": "MP3",
    "speakingRate": 1.5,
    "pitch": 2.0,
    "volumeGainDb": 5.0
  }'
```

#### WAV 파일로 저장
```bash
curl -X POST https://translator.example.com/tts \
  -H "Content-Type: application/json" \
  -H "X-App-Token: app-token-for-translate-secure" \
  -d '{
    "text": "안녕하세요",
    "languageCode": "ko-KR",
    "audioEncoding": "LINEAR16"
  }' | jq -r '.audioContent' | base64 -d > output.wav
```

### 응답

#### 성공 응답 (200 OK)
```json
{
  "audioContent": "//uQxAAAAAAAAAAAAAAASW5mbwAAAA8AAAASAAAeoAAUFBQUFBwcHBwcHCQkJCQkJCwsLCwsLDMzMzMzMzs7Ozs7O0JCQkJCQkpKSkpKSlJSUlJSUlpaWlpaWmJiYmJiYmpqampqanJycnJycnp6enp6eoKCgoKCgoqKioqKipKSkpKSkpqampqamqKioqKiorKysrKysrq6urq6usLCwsLCwsrKysrKytLS0tLS0tra2tra2uLi4uLi4urq6urq6vLy8vLy8vr6+vr6+wMDAwMDA...",
  "metered_chars": 5,
  "month_key": "2025-10-PT",
  "api_type": "tts",
  "used_after": 50005,
  "limit": 4000000,
  "audioEncoding": "MP3"
}
```

#### 에러 응답 (429 Too Many Requests)
```json
{
  "error": "🇰🇷 이번 달 음성합성 무료 사용량을 모두 사용했습니다.\n🇱🇦 ຂ້ອຍໄດ້ໃຊ້ປະລິມານການສັງເຄາະສຽງຟຣີຂອງເດືອນນີ້ໝົດແລ້ວ.",
  "code": "TTS_FREE_TIER_EXHAUSTED",
  "api_type": "tts"
}
```

### 응답 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `audioContent` | string | Base64로 인코딩된 오디오 데이터 |
| `metered_chars` | number | 이번 요청에서 사용된 문자 수 |
| `month_key` | string | 현재 월 키 (PST 기준) |
| `api_type` | string | API 타입 (`tts`) |
| `used_after` | number | 요청 후 누적 사용량 |
| `limit` | number | 월별 한도 |
| `audioEncoding` | string | 반환된 오디오 포맷 |

### 오디오 데이터 사용 방법

#### JavaScript (브라우저)
```javascript
const response = await fetch('https://translator.example.com/tts', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-App-Token': 'your-token'
  },
  body: JSON.stringify({ text: '안녕하세요' })
});

const data = await response.json();
const audioBlob = base64ToBlob(data.audioContent, 'audio/mp3');
const audioUrl = URL.createObjectURL(audioBlob);
const audio = new Audio(audioUrl);
audio.play();

function base64ToBlob(base64, mimeType) {
  const bytes = atob(base64);
  const buffer = new ArrayBuffer(bytes.length);
  const array = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    array[i] = bytes.charCodeAt(i);
  }
  return new Blob([buffer], { type: mimeType });
}
```

#### Flutter
```dart
import 'dart:convert';
import 'dart:typed_data';
import 'package:audioplayers/audioplayers.dart';

final response = await http.post(
  Uri.parse('https://translator.example.com/tts'),
  headers: {
    'Content-Type': 'application/json',
    'X-App-Token': 'your-token',
  },
  body: jsonEncode({'text': '안녕하세요'}),
);

final data = jsonDecode(response.body);
final Uint8List audioBytes = base64Decode(data['audioContent']);

final player = AudioPlayer();
await player.play(BytesSource(audioBytes));
```

---

## 🧱 로컬 테스트 (Docker 없이)

```bash
cd server
npm install
node index.js
```

서버 실행 후:
```bash
# 헬스 체크
curl http://localhost:3000/healthz

# 사용량 조회
curl http://localhost:3000/usage
```

---

## 🔧 문제 해결

### 서버가 시작되지 않을 때
```bash
# 로그 확인
docker compose logs -f huab-translator-api

# 컨테이너 재시작
docker compose restart huab-translator-api
```

### 마이그레이션 오류 발생 시
서버 로그에서 마이그레이션 상태 확인:
```
[Migration] Applying: 003_separate_api_usage - Separate Translation and TTS usage tracking
[Migration] Success: 003_separate_api_usage
[Database] Applied migrations: 3
```

문제 발생 시 [MIGRATIONS.md](MIGRATIONS.md) 참조

### API 키 오류
```bash
# .env 파일 확인
cat .env | grep GOOGLE_API_KEY

# 헬스 체크로 API 키 유효성 확인
curl http://localhost:3000/healthz
```

---

## ⚠️ 주의사항

1. **보안**
   - `.env`, `data/usage.sqlite` 파일은 절대 Git에 업로드 금지
   - 프로덕션 환경에서는 `APP_TOKEN`을 강력한 무작위 문자열로 변경
   - HTTPS 역프록시 (Nginx, Cloudflare) 사용 권장

2. **Google Cloud 설정**
   - Google Cloud Console에서 다음 API 활성화 필요:
     - Cloud Translation API
     - Cloud Text-to-Speech API
   - API 키 제한 설정 권장 (허용 API 목록 지정)

3. **데이터베이스**
   - `data/` 디렉토리는 `chmod 700` 이상 권한으로 설정
   - 정기적으로 `data/usage.sqlite` 백업 권장

4. **Quota 관리**
   - Translation: 월 50만 문자 초과 시 과금
   - TTS Standard: 월 400만 문자 초과 시 과금
   - 사용량은 `/usage` 엔드포인트로 실시간 모니터링

---

## 📚 추가 문서

- [CLAUDE.md](CLAUDE.md) - Claude Code용 개발 가이드
- [MIGRATIONS.md](MIGRATIONS.md) - 데이터베이스 마이그레이션 가이드
- [Google Translation API 문서](https://cloud.google.com/translate/docs)
- [Google Text-to-Speech API 문서](https://cloud.google.com/text-to-speech/docs)

---

## 🪪 라이선스

MIT License © 2025 Wody

자유롭게 수정 및 배포 가능합니다. 단, Google API Key는 개인 소유로 유지하세요.

---

## 🤝 기여

이슈 및 Pull Request는 언제든지 환영합니다!

**버그 리포트:** https://github.com/wodykr/huab_translator_backServer/issues
