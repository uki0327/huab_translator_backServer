# 🌐 Huab Translator API Server

**Huab Translator** 모바일 앱을 위한 백엔드 API 서버입니다.
Google Cloud API (Translation v2 & Text-to-Speech v1)를 안전하게 프록시하여, 모바일 앱에서 **API Key 노출 없이** 번역 및 음성합성 기능을 사용할 수 있습니다.

---

## 📑 목차

### 모바일 앱 개발자용
- [📱 빠른 시작](#-모바일-앱-개발자를-위한-빠른-시작) - Flutter 통합 예제
- [🧠 API 엔드포인트 요약](#-api-엔드포인트-요약) - 전체 API 개요
- [📊 사용량 조회 API](#-사용량-조회-api) - Quota 확인
- [📤 번역 API](#-번역-api-translation) - 텍스트 번역
- [🔊 음성합성 API](#-음성합성-api-text-to-speech) - TTS 기능
- [💡 Flutter Service 클래스](#-flutter-service-클래스-완전한-예제) - 완전한 구현 예제

### 서버 관리자용
- [⚙️ 설치 방법](#️-설치-방법) - Docker 배포
- [🧩 환경 변수](#-환경-변수-상세-설명) - 서버 설정
- [🔧 문제 해결](#-문제-해결) - 트러블슈팅
- [📚 추가 문서](#-추가-문서) - 상세 가이드

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

## 📱 모바일 앱 개발자를 위한 빠른 시작

### 서버 URL 및 인증

**프로덕션 서버 URL:**
```
https://your-server-domain.com
```

**인증 방법:**
- 모든 API 요청에 `X-App-Token` 헤더 필요
- 토큰 값은 서버 관리자에게 문의

### Flutter 패키지 설치

```yaml
# pubspec.yaml
dependencies:
  http: ^1.1.0
  audioplayers: ^5.2.1  # TTS 재생용
```

### 기본 사용 예제

#### 1. 번역 요청
```dart
import 'package:http/http.dart' as http;
import 'dart:convert';

Future<String> translate(String text, {String from = 'ko', String to = 'lo'}) async {
  final response = await http.post(
    Uri.parse('https://your-server-domain.com/translate'),
    headers: {
      'Content-Type': 'application/json',
      'X-App-Token': 'your-app-token-here',
    },
    body: jsonEncode({
      'text': text,
      'source': from,
      'target': to,
    }),
  );

  if (response.statusCode == 200) {
    final data = jsonDecode(response.body);
    return data['translations'][0];
  } else if (response.statusCode == 429) {
    throw Exception('월 사용량 초과');
  } else {
    throw Exception('번역 실패: ${response.statusCode}');
  }
}
```

#### 2. 음성합성 (TTS) 요청
```dart
import 'dart:typed_data';
import 'package:audioplayers/audioplayers.dart';

Future<void> speakText(String text, {String lang = 'ko-KR'}) async {
  final response = await http.post(
    Uri.parse('https://your-server-domain.com/tts'),
    headers: {
      'Content-Type': 'application/json',
      'X-App-Token': 'your-app-token-here',
    },
    body: jsonEncode({
      'text': text,
      'languageCode': lang,
      'audioEncoding': 'MP3',
    }),
  );

  if (response.statusCode == 200) {
    final data = jsonDecode(response.body);
    final Uint8List audioBytes = base64Decode(data['audioContent']);

    final player = AudioPlayer();
    await player.play(BytesSource(audioBytes));
  } else {
    throw Exception('TTS 실패: ${response.statusCode}');
  }
}
```

#### 3. 사용량 조회
```dart
Future<Map<String, dynamic>> getUsage() async {
  final response = await http.get(
    Uri.parse('https://your-server-domain.com/usage'),
  );

  if (response.statusCode == 200) {
    return jsonDecode(response.body);
  } else {
    throw Exception('사용량 조회 실패');
  }
}

// 사용 예시
void checkUsage() async {
  final usage = await getUsage();
  print('번역 사용량: ${usage['translation']['used']}/${usage['translation']['limit']}');
  print('TTS 사용량: ${usage['tts']['used']}/${usage['tts']['limit']}');
}
```

### 에러 처리

```dart
Future<String> translateWithErrorHandling(String text) async {
  try {
    final response = await http.post(
      Uri.parse('https://your-server-domain.com/translate'),
      headers: {
        'Content-Type': 'application/json',
        'X-App-Token': 'your-app-token-here',
      },
      body: jsonEncode({'text': text}),
    ).timeout(Duration(seconds: 10));

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      return data['translations'][0];
    } else if (response.statusCode == 401) {
      throw Exception('인증 실패: APP_TOKEN을 확인하세요');
    } else if (response.statusCode == 429) {
      final data = jsonDecode(response.body);
      throw Exception(data['error']);
    } else {
      throw Exception('서버 오류: ${response.statusCode}');
    }
  } catch (e) {
    print('번역 오류: $e');
    rethrow;
  }
}
```

---

## 📁 폴더 구조
```
huab_translator_backServer/
├── server/
│   ├── index.js          # 메인 서버 로직 (Translation & TTS)
│   ├── package.json      # v2.1.1
│   ├── Dockerfile        # Alpine 기반 Node.js 18 이미지
│   ├── .dockerignore     # Docker 빌드 최적화
│   └── env.example       # 서버 전용 환경변수 예시 (참고용)
├── data/                 # (자동 생성됨, SQLite 데이터 저장)
├── .env                  # (로컬 환경 설정, Git에 업로드 금지)
├── .env.example          # 환경 변수 템플릿 (상세 주석 포함)
├── docker-compose.yaml   # Docker Compose 설정
├── docker_check.sh       # Docker 설정 점검 스크립트 (NEW)
├── test_db_migration.sh  # 데이터베이스 마이그레이션 테스트 (NEW)
├── CLAUDE.md             # Claude Code용 개발 가이드
├── MIGRATIONS.md         # 데이터베이스 마이그레이션 가이드
├── DOCKER.md             # Docker 배포 상세 가이드 (NEW)
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
cp .env.example .env
```

### 3. 환경 변수 수정
```bash
nano .env
```

**필수 설정 항목:**
- `GOOGLE_API_KEY`: Google Cloud Console에서 발급받은 API 키
- `APP_TOKEN`: 클라이언트 인증용 토큰 (강력한 무작위 문자열 권장)

**선택 설정 항목:** (기본값 사용 가능)
- Translation/TTS 무료 한도 및 차단 임계값
- 서버 포트, DB 경로, Healthcheck 설정

자세한 내용은 `.env.example` 파일의 주석을 참조하세요.

### 4. Docker 설정 점검 (권장)
```bash
./docker_check.sh
```

이 스크립트는 다음을 확인합니다:
- ✓ 필수 파일 존재 여부
- ✓ Dockerfile 구성
- ✓ docker-compose.yaml 설정
- ✓ 빌드 컨텍스트 최적화
- ✓ 볼륨 및 권한 설정

### 5. Docker Compose 실행
```bash
docker compose up -d
```

### 6. 서버 상태 확인
```bash
curl http://localhost:3000/healthz
# 응답: ok
```

---

## 🧩 환경 변수 상세 설명

### 필수 환경 변수

| 변수명 | 설명 |
|--------|------|
| `GOOGLE_API_KEY` | Google Cloud API 키 (Translation & TTS 공통) |
| `APP_TOKEN` | API 요청 인증용 토큰 (X-App-Token 헤더) |

### 선택 환경 변수 (기본값 포함)

| 카테고리 | 변수명 | 설명 | 기본값 |
|----------|--------|------|--------|
| **서버** | `PORT` | 서버 포트 번호 | `3000` |
| **Translation** | `TRANSLATE_FREE_TIER_CHARS` | 월별 무료 한도 (문자 수) | `500000` (50만) |
| | `TRANSLATE_FREEZE_THRESHOLD_PCT` | 차단 임계 비율 (%) | `98` |
| **TTS** | `TTS_FREE_TIER_CHARS` | 월별 무료 한도 (문자 수) | `4000000` (400만) |
| | `TTS_FREEZE_THRESHOLD_PCT` | 차단 임계 비율 (%) | `98` |
| **Database** | `SQLITE_PATH` | SQLite DB 파일 경로 | `/app/data/usage.sqlite` |
| **Healthcheck** | `HEALTHCHECK_INTERVAL` | 체크 주기 | `30s` |
| | `HEALTHCHECK_TIMEOUT` | 타임아웃 | `5s` |
| | `HEALTHCHECK_RETRIES` | 재시도 횟수 | `3` |
| | `HEALTHCHECK_START_PERIOD` | 시작 대기 시간 | `10s` |

### Quota 설정 예시

**더 보수적인 차단** (90% 도달 시):
```env
TRANSLATE_FREEZE_THRESHOLD_PCT=90
TTS_FREEZE_THRESHOLD_PCT=90
```

**Translation만 제한 없이** (개발/테스트 환경):
```env
TRANSLATE_FREE_TIER_CHARS=999999999
TRANSLATE_FREEZE_THRESHOLD_PCT=100
```

**참고:**
- Translation과 TTS는 **별도 quota**로 관리됩니다
- Translation이 차단되어도 TTS는 계속 사용 가능 (반대도 동일)
- 각 API별로 무료 한도와 차단 임계값을 독립적으로 설정 가능

---

## 🧠 API 엔드포인트 요약

**Base URL:** `https://your-server-domain.com`

| 메서드 | 경로 | 설명 | 인증 | 비고 |
|--------|------|------|------|------|
| `GET` | `/healthz` | 서버 상태 확인 | ❌ | 서버 동작 여부 체크 |
| `GET` | `/usage` | 월별 사용량 조회 | ❌ | 실시간 quota 확인 |
| `POST` | `/translate` | 텍스트 번역 | ✅ | 한↔라오 번역 등 |
| `POST` | `/tts` | 텍스트 음성 변환 | ✅ | MP3/WAV 오디오 생성 |

**인증 헤더:**
```
X-App-Token: your-app-token-here
```

**공통 에러 코드:**
- `401 Unauthorized`: 인증 토큰 없음/잘못됨
- `429 Too Many Requests`: 월 사용량 초과
- `500 Internal Server Error`: 서버 오류

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
| 한국어 | `ko-KR` | `ko-KR-Standard-A`, `ko-KR-Standard-B`, `ko-KR-Standard-C`, `ko-KR-Standard-D` |
| 영어(미국) | `en-US` | `en-US-Standard-A`, `en-US-Standard-B`, `en-US-Standard-C`, `en-US-Standard-D` |
| 일본어 | `ja-JP` | `ja-JP-Standard-A`, `ja-JP-Standard-B`, `ja-JP-Standard-C`, `ja-JP-Standard-D` |
| 중국어 | `zh-CN` | `zh-CN-Standard-A`, `zh-CN-Standard-B`, `zh-CN-Standard-C`, `zh-CN-Standard-D` |
| 태국어 | `th-TH` | `th-TH-Standard-A` |
| 라오어 | `lo-LA` | `lo-LA-Standard-A` |

**참고:** Standard 음성만 사용합니다 (월 400만 문자 무료).

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

## 💡 Flutter Service 클래스 (완전한 예제)

프로덕션에서 사용할 수 있는 완전한 API 서비스 클래스입니다.

### lib/services/translator_api_service.dart

```dart
import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;

class TranslatorApiService {
  final String baseUrl;
  final String appToken;
  final Duration timeout;

  TranslatorApiService({
    required this.baseUrl,
    required this.appToken,
    this.timeout = const Duration(seconds: 10),
  });

  // ==========================================
  // 번역 API
  // ==========================================

  /// 단일 텍스트 번역
  Future<String> translate(
    String text, {
    String from = 'ko',
    String to = 'lo',
  }) async {
    final result = await translateBatch([text], from: from, to: to);
    return result.first;
  }

  /// 배치 번역 (여러 텍스트 한 번에)
  Future<List<String>> translateBatch(
    List<String> texts, {
    String from = 'ko',
    String to = 'lo',
  }) async {
    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/translate'),
            headers: {
              'Content-Type': 'application/json',
              'X-App-Token': appToken,
            },
            body: jsonEncode({
              'text': texts,
              'source': from,
              'target': to,
            }),
          )
          .timeout(timeout);

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return List<String>.from(data['translations']);
      } else if (response.statusCode == 401) {
        throw TranslatorApiException('인증 실패', code: 'AUTH_FAILED');
      } else if (response.statusCode == 429) {
        final data = jsonDecode(response.body);
        throw TranslatorApiException(
          data['error'] ?? '월 사용량 초과',
          code: data['code'] ?? 'QUOTA_EXCEEDED',
        );
      } else {
        throw TranslatorApiException(
          '번역 실패 (${response.statusCode})',
          code: 'TRANSLATION_FAILED',
        );
      }
    } catch (e) {
      if (e is TranslatorApiException) rethrow;
      throw TranslatorApiException('네트워크 오류: $e', code: 'NETWORK_ERROR');
    }
  }

  // ==========================================
  // TTS API
  // ==========================================

  /// 텍스트를 음성으로 변환 (MP3 bytes 반환)
  Future<Uint8List> textToSpeech(
    String text, {
    String languageCode = 'ko-KR',
    String? voiceName,
    String ssmlGender = 'NEUTRAL',
    String audioEncoding = 'MP3',
    double speakingRate = 1.0,
    double pitch = 0.0,
    double volumeGainDb = 0.0,
  }) async {
    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/tts'),
            headers: {
              'Content-Type': 'application/json',
              'X-App-Token': appToken,
            },
            body: jsonEncode({
              'text': text,
              'languageCode': languageCode,
              if (voiceName != null) 'voiceName': voiceName,
              'ssmlGender': ssmlGender,
              'audioEncoding': audioEncoding,
              'speakingRate': speakingRate,
              'pitch': pitch,
              'volumeGainDb': volumeGainDb,
            }),
          )
          .timeout(timeout);

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return base64Decode(data['audioContent']);
      } else if (response.statusCode == 401) {
        throw TranslatorApiException('인증 실패', code: 'AUTH_FAILED');
      } else if (response.statusCode == 429) {
        final data = jsonDecode(response.body);
        throw TranslatorApiException(
          data['error'] ?? 'TTS 월 사용량 초과',
          code: data['code'] ?? 'TTS_QUOTA_EXCEEDED',
        );
      } else {
        throw TranslatorApiException(
          'TTS 실패 (${response.statusCode})',
          code: 'TTS_FAILED',
        );
      }
    } catch (e) {
      if (e is TranslatorApiException) rethrow;
      throw TranslatorApiException('네트워크 오류: $e', code: 'NETWORK_ERROR');
    }
  }

  // ==========================================
  // 사용량 조회 API
  // ==========================================

  /// 현재 월 사용량 조회
  Future<UsageInfo> getUsage() async {
    try {
      final response = await http
          .get(Uri.parse('$baseUrl/usage'))
          .timeout(timeout);

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return UsageInfo.fromJson(data);
      } else {
        throw TranslatorApiException(
          '사용량 조회 실패 (${response.statusCode})',
          code: 'USAGE_FETCH_FAILED',
        );
      }
    } catch (e) {
      if (e is TranslatorApiException) rethrow;
      throw TranslatorApiException('네트워크 오류: $e', code: 'NETWORK_ERROR');
    }
  }

  // ==========================================
  // 헬스체크 API
  // ==========================================

  /// 서버 상태 확인
  Future<bool> checkHealth() async {
    try {
      final response = await http
          .get(Uri.parse('$baseUrl/healthz'))
          .timeout(Duration(seconds: 5));
      return response.statusCode == 200 && response.body == 'ok';
    } catch (e) {
      return false;
    }
  }
}

// ==========================================
// 데이터 모델
// ==========================================

class UsageInfo {
  final String monthKey;
  final ApiUsage translation;
  final ApiUsage tts;

  UsageInfo({
    required this.monthKey,
    required this.translation,
    required this.tts,
  });

  factory UsageInfo.fromJson(Map<String, dynamic> json) {
    return UsageInfo(
      monthKey: json['month_key'],
      translation: ApiUsage.fromJson(json['translation']),
      tts: ApiUsage.fromJson(json['tts']),
    );
  }

  /// 번역 API 사용 가능 여부
  bool get canUseTranslation => !translation.frozen && translation.remaining > 0;

  /// TTS API 사용 가능 여부
  bool get canUseTts => !tts.frozen && tts.remaining > 0;
}

class ApiUsage {
  final int used;
  final int limit;
  final int remaining;
  final int thresholdPct;
  final bool frozen;
  final String unit;

  ApiUsage({
    required this.used,
    required this.limit,
    required this.remaining,
    required this.thresholdPct,
    required this.frozen,
    required this.unit,
  });

  factory ApiUsage.fromJson(Map<String, dynamic> json) {
    return ApiUsage(
      used: json['used'],
      limit: json['limit'],
      remaining: json['remaining'],
      thresholdPct: json['threshold_pct'],
      frozen: json['frozen'],
      unit: json['unit'],
    );
  }

  /// 사용률 (0.0 ~ 1.0)
  double get usageRate => used / limit;

  /// 사용률 퍼센트 (0 ~ 100)
  int get usagePercent => (usageRate * 100).round();

  /// 임계값 도달 여부
  bool get nearLimit => usagePercent >= thresholdPct;
}

// ==========================================
// 예외 클래스
// ==========================================

class TranslatorApiException implements Exception {
  final String message;
  final String code;

  TranslatorApiException(this.message, {required this.code});

  @override
  String toString() => 'TranslatorApiException: $message (code: $code)';

  /// 사용자에게 표시할 메시지
  String get userFriendlyMessage {
    switch (code) {
      case 'AUTH_FAILED':
        return '인증에 실패했습니다. 앱을 다시 시작해주세요.';
      case 'TRANSLATION_FREE_TIER_EXHAUSTED':
      case 'QUOTA_EXCEEDED':
        return '이번 달 번역 무료 사용량을 모두 사용했습니다.';
      case 'TTS_FREE_TIER_EXHAUSTED':
      case 'TTS_QUOTA_EXCEEDED':
        return '이번 달 음성합성 무료 사용량을 모두 사용했습니다.';
      case 'NETWORK_ERROR':
        return '네트워크 연결을 확인해주세요.';
      default:
        return message;
    }
  }
}
```

### 사용 예제

```dart
void main() async {
  // 서비스 초기화
  final api = TranslatorApiService(
    baseUrl: 'https://your-server-domain.com',
    appToken: 'your-app-token-here',
  );

  try {
    // 1. 서버 상태 확인
    final isHealthy = await api.checkHealth();
    print('서버 상태: ${isHealthy ? "정상" : "오류"}');

    // 2. 사용량 조회
    final usage = await api.getUsage();
    print('번역 사용률: ${usage.translation.usagePercent}%');
    print('TTS 사용률: ${usage.tts.usagePercent}%');

    // 3. 번역 실행
    if (usage.canUseTranslation) {
      final translated = await api.translate('안녕하세요', from: 'ko', to: 'lo');
      print('번역 결과: $translated');
    }

    // 4. 배치 번역
    final batch = await api.translateBatch(
      ['안녕하세요', '감사합니다', '사랑해요'],
      from: 'ko',
      to: 'en',
    );
    print('배치 번역: $batch');

    // 5. TTS 실행
    if (usage.canUseTts) {
      final audioBytes = await api.textToSpeech('안녕하세요');
      print('음성 데이터 크기: ${audioBytes.length} bytes');

      // AudioPlayer로 재생
      // final player = AudioPlayer();
      // await player.play(BytesSource(audioBytes));
    }
  } on TranslatorApiException catch (e) {
    print('API 오류: ${e.userFriendlyMessage}');
  } catch (e) {
    print('예상치 못한 오류: $e');
  }
}
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
