# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A lightweight Node.js proxy server that securely wraps Google Cloud APIs (Translation v2 and Text-to-Speech v1) to protect API keys from client exposure. Built for Flutter and other external apps to use Google services without exposing credentials.

**Key Features:**
- API key protection (server-side only)
- **Two services**: Translation (v2) and Text-to-Speech (v1)
- Monthly usage tracking and automatic quota management (default: 500k chars/month)
- Automatic blocking at 96-98% usage threshold
- Monthly reset on 1st of each month (PST/PDT timezone)
- SQLite3 local database with automatic initialization
- Docker deployment support

## Development Commands

### Local Development (without Docker)
```bash
cd server
npm install
node index.js
```

### Docker Deployment
```bash
# Start the service
docker compose up -d

# View logs
docker compose logs -f huab-translator-api

# Stop the service
docker compose down

# Rebuild and restart
docker compose up -d --build
```

### Testing
```bash
# Health check
curl http://localhost:3000/healthz

# Check usage stats
curl http://localhost:3000/usage

# Test translation (requires X-App-Token header)
curl -X POST http://localhost:3000/translate \
  -H "Content-Type: application/json" \
  -H "X-App-Token: your-token-here" \
  -d '{"text":"안녕하세요","source":"ko","target":"lo"}'

# Test text-to-speech (requires X-App-Token header)
curl -X POST http://localhost:3000/tts \
  -H "Content-Type: application/json" \
  -H "X-App-Token: your-token-here" \
  -d '{"text":"안녕하세요","languageCode":"ko-KR","audioEncoding":"MP3"}'
```

## Architecture

### Core Components

**Single-file architecture** ([server/index.js](server/index.js)): All logic is contained in one Express.js application file.

**Key architectural patterns:**

1. **PST/PDT Timezone-based Monthly Rollover** (lines 58-67)
   - Uses `Intl.DateTimeFormat` with `America/Los_Angeles` timezone
   - Generates month keys like `2025-10-PT` for tracking
   - Automatic daylight saving time handling
   - Resets occur at 4pm KST (March-October) or 5pm KST (November-February)

2. **Usage Metering System** (lines 227-241)
   - Character counting uses Unicode codepoint normalization (NFC)
   - Pre-flight quota check BEFORE calling Google API
   - Threshold calculation: `(used + request) * 100 >= limit * threshold_pct`
   - Automatic freeze when hitting 96-98% threshold
   - Prevents overage charges

3. **Database Schema & Migrations** (lines 70-167)
   - **Migration system**: Version-tracked, sequential, transaction-based
   - **Migration metadata**: `schema_migrations` table tracks applied migrations
   - **Main table**: `usage_monthly` with columns:
     - `month_key` (PRIMARY KEY): PST-based month identifier
     - `chars_used`: accumulated character count (Translation + TTS combined)
     - `frozen`: boolean flag (0/1) for quota exhaustion
     - `updated_at`: timestamp of last update
   - **Migration history**:
     - `001_init`: Initial schema (v1.0.0)
     - `002_tts_support`: TTS support marker (v2.0.0, no schema changes)
   - WAL mode for better concurrency
   - Auto-creates DB directory with 0700 permissions
   - **Zero-downtime upgrades**: Backward compatible, preserves existing data
   - See [MIGRATIONS.md](MIGRATIONS.md) for detailed migration guide

4. **Google Translation API v2 Integration** (lines 243-273)
   - Uses API Key authentication (not OAuth)
   - Endpoint: `https://translation.googleapis.com/language/translate/v2`
   - Supports batch translation (array of strings)
   - Retry logic: 3 attempts with exponential backoff on 429/5xx errors
   - Request body format: `{q: string[], source: string, target: string, format: 'text'}`

5. **Google Text-to-Speech API v1 Integration** (lines 295-404)
   - Uses API Key authentication via query parameter
   - Endpoint: `https://texttospeech.googleapis.com/v1/text:synthesize`
   - Returns base64-encoded audio in response
   - Supports multiple audio formats (MP3, LINEAR16, OGG_OPUS, etc.)
   - Configurable voice parameters: languageCode, voiceName, ssmlGender, speakingRate, pitch, volumeGainDb
   - Character metering based on input text length
   - Same retry logic as translation: 3 attempts with exponential backoff

6. **Security Model & CORS** (lines 28-33, 300-322)
   - API key loaded from env var `GOOGLE_API_KEY` or file `GOOGLE_API_KEY_FILE`
   - App token authentication via `X-App-Token` header (required for `/translate` and `/tts`)
   - **CORS middleware**: Configurable origin whitelist via `ALLOWED_ORIGINS` env var
     - Empty = allow all origins (`*`)
     - Set = only allow specified origins (comma-separated)
     - Supports preflight OPTIONS requests
   - Database file permissions enforced at 0600
   - Express app runs as non-root user in Docker container
   - 256kb JSON body limit

### API Endpoints

- `GET /healthz`: Health check (validates Google API key is configured)
- `GET /usage`: Public endpoint showing current month's usage stats
- `POST /translate`: Translation proxy (requires `X-App-Token` auth)
- `POST /tts`: Text-to-Speech proxy (requires `X-App-Token` auth)

#### TTS Request Format
```json
{
  "text": "안녕하세요",
  "languageCode": "ko-KR",
  "voiceName": "ko-KR-Standard-A",
  "ssmlGender": "NEUTRAL",
  "audioEncoding": "MP3",
  "speakingRate": 1.0,
  "pitch": 0.0,
  "volumeGainDb": 0.0
}
```

**TTS Parameters:**
- `text` (required): Text to synthesize
- `languageCode` (optional): Default `ko-KR` (Korean)
- `voiceName` (optional): Specific voice name (e.g., `ko-KR-Standard-A`)
- `ssmlGender` (optional): `NEUTRAL`, `MALE`, `FEMALE` (default: `NEUTRAL`)
- `audioEncoding` (optional): `MP3`, `LINEAR16`, `OGG_OPUS`, `MULAW`, `ALAW` (default: `MP3`)
- `speakingRate` (optional): 0.25 to 4.0 (default: 1.0)
- `pitch` (optional): -20.0 to 20.0 (default: 0.0)
- `volumeGainDb` (optional): -96.0 to 16.0 (default: 0.0)

#### TTS Response Format
```json
{
  "audioContent": "base64-encoded-audio-bytes",
  "metered_chars": 5,
  "month_key": "2025-10-PT",
  "used_after": 12350,
  "limit": 500000,
  "audioEncoding": "MP3"
}
```

### Environment Variables

All configured in `.env` file (see [server/env.example](server/env.example)):

| Variable | Purpose | Default |
|----------|---------|---------|
| `GOOGLE_API_KEY` | Google Cloud API key (used for both Translation and TTS) | (required) |
| `GOOGLE_API_KEY_FILE` | Alternative: path to file containing API key | - |
| `APP_TOKEN` | Authentication token for `/translate` and `/tts` endpoints | - |
| `PORT` | Server port | 3000 |
| `SERVER_DOMAIN` | Server public domain (for logging/documentation) | http://localhost:3000 |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated, empty = allow all) | (empty) |
| `TRANSLATE_FREE_TIER_CHARS` | Translation monthly character limit | 500000 |
| `TRANSLATE_FREEZE_THRESHOLD_PCT` | Translation usage % to trigger freeze | 98 |
| `TTS_FREE_TIER_CHARS` | TTS monthly character limit | 4000000 |
| `TTS_FREEZE_THRESHOLD_PCT` | TTS usage % to trigger freeze | 98 |
| `SQLITE_PATH` | Database file path | ./data/usage.sqlite |

## File Structure

```
huab_translator_backServer/
├── server/
│   ├── index.js              # Main application file (all logic)
│   ├── package.json          # NPM dependencies (ES modules)
│   ├── Dockerfile            # Alpine-based Node 18 image
│   └── env.example           # Environment variable template
├── data/                     # Auto-generated SQLite database directory
├── docker-compose.yaml       # Docker Compose configuration
├── .env                      # Local environment config (git-ignored)
└── README.md                 # Korean documentation
```

## Important Implementation Details

1. **ES Modules**: Uses `"type": "module"` in package.json - all imports must use `import` syntax
2. **Character Counting**: Uses Unicode NFC normalization and codepoint-based counting (not byte length)
3. **Month Rollover**: Automatically creates new monthly records on first request of new PST month
4. **Freeze Behavior**: Once frozen, remains frozen until next month (no manual reset)
5. **Prepared Statements**: All DB queries use prepared statements for performance and safety
6. **Error Handling**: Retry logic only for 429 and 5xx errors; 4xx errors fail immediately
7. **Database Migrations**:
   - Sequential, transaction-based migrations ensure data integrity
   - Upgrading from v1.0.0 to v2.0.0+ preserves all existing usage data
   - Never modify already-applied migrations
   - Add new migrations with incremental numbering (003, 004, etc.)
   - See [MIGRATIONS.md](MIGRATIONS.md) for adding new migrations

## Dependencies

- `express`: Web framework
- `morgan`: HTTP request logger
- `better-sqlite3`: Synchronous SQLite3 bindings
- Node 18+ (uses native `fetch`, falls back to `node-fetch` polyfill)

## Security Considerations

- Never commit `.env` or `data/usage.sqlite` files
- Use strong, random `APP_TOKEN` in production
- Deploy behind HTTPS reverse proxy (Nginx, Cloudflare)
- Database directory should have 0700 permissions
- Docker container runs as non-root user
