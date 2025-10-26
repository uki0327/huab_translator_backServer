// index.js — 경량 번역 프록시(v2 API Key 사용, 사용량 집계 + 96% 차단 + PST 월 롤오버 + SQLite 자동 초기화)

import fs from 'fs';
import path from 'path';
import express from 'express';
import morgan from 'morgan';
import Database from 'better-sqlite3';

// ─────────────────────────────────────────────
// 환경 및 기본 설정
// ─────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3000);

// Translation API 무료 한도 (Google: 월 50만 문자)
const TRANSLATE_FREE_LIMIT = Number(process.env.TRANSLATE_FREE_TIER_CHARS || 500000);
const TRANSLATE_FREEZE_PCT = Number(process.env.TRANSLATE_FREEZE_THRESHOLD_PCT || 98);

// TTS API 무료 한도 (Google Standard: 월 400만 문자, WaveNet: 월 100만 문자)
const TTS_FREE_LIMIT = Number(process.env.TTS_FREE_TIER_CHARS || 4000000);
const TTS_FREEZE_PCT = Number(process.env.TTS_FREEZE_THRESHOLD_PCT || 98);

const SQLITE_PATH = process.env.SQLITE_PATH || './data/usage.sqlite';
const APP_TOKEN = (process.env.APP_TOKEN || '').trim();

const GOOGLE_API_KEY_FILE = process.env.GOOGLE_API_KEY_FILE || '';
const GOOGLE_API_KEY_ENV = process.env.GOOGLE_API_KEY || '';

// CORS 설정 (클라이언트 도메인)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// 서버 공개 도메인 (로그/문서화 용도)
const SERVER_DOMAIN = process.env.SERVER_DOMAIN || `http://localhost:${PORT}`;

// Node 18 미만 환경 대비 폴리필
const fetch = globalThis.fetch ?? (await import('node-fetch')).default;

// ─────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────
function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}
function ensureFilePerm600(filePath) {
  try { fs.chmodSync(filePath, 0o600); } catch {}
}
function loadGoogleApiKey() {
  if (GOOGLE_API_KEY_FILE) {
    try {
      const key = fs.readFileSync(GOOGLE_API_KEY_FILE, 'utf8').trim();
      if (key) return key;
    } catch (e) {
      console.error('구글 API 키 파일을 읽지 못했습니다:', e.message);
    }
  }
  if (GOOGLE_API_KEY_ENV) return GOOGLE_API_KEY_ENV.trim();
  throw new Error('Google API Key 미설정: GOOGLE_API_KEY 또는 GOOGLE_API_KEY_FILE 필요');
}

// 코드포인트 기준 문자수(공백/특수문자/이모지/HTML 포함)
function countCharsCodePoint(s) {
  if (typeof s !== 'string') return 0;
  return Array.from(s.normalize('NFC')).length;
}
function countCharsBatch(arr) {
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((a, t) => a + countCharsCodePoint(String(t)), 0);
}

// PST 기준 월 키 생성(서머타임 자동 반영)
function getMonthKeyPST(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(date);
  const yr = parts.find(p => p.type === 'year')?.value;
  const mo = parts.find(p => p.type === 'month')?.value;
  return `${yr}-${mo}-PT`; // e.g., 2025-10-PT
}

// ─────────────────────────────────────────────
// SQLite 초기화 및 마이그레이션
// ─────────────────────────────────────────────
ensureParentDir(SQLITE_PATH);
const isNewDb = !fs.existsSync(SQLITE_PATH);
const db = new Database(SQLITE_PATH);
ensureFilePerm600(SQLITE_PATH);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// 마이그레이션 메타 테이블 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL,
    description TEXT
  )
`);

// 마이그레이션 헬퍼 함수
function hasMigration(name) {
  return !!db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(name);
}

function applyMigration(name, description, sqlOrFn) {
  if (hasMigration(name)) {
    console.log(`[Migration] Skip: ${name} (already applied)`);
    return;
  }

  const now = new Date().toISOString();
  console.log(`[Migration] Applying: ${name} - ${description}`);

  const tx = db.transaction(() => {
    // SQL 문자열이면 exec, 함수면 실행
    if (typeof sqlOrFn === 'string') {
      db.exec(sqlOrFn);
    } else if (typeof sqlOrFn === 'function') {
      sqlOrFn(db);
    }
    db.prepare('INSERT INTO schema_migrations (name, applied_at, description) VALUES (?, ?, ?)')
      .run(name, now, description);
  });

  try {
    tx();
    console.log(`[Migration] Success: ${name}`);
  } catch (e) {
    console.error(`[Migration] Failed: ${name}`, e.message);
    throw e;
  }
}

// ─────────────────────────────────────────────
// 마이그레이션 정의 (순서대로 실행됨)
// ─────────────────────────────────────────────

// v1.0.0: 초기 스키마
applyMigration('001_init', 'Create usage_monthly table', `
  CREATE TABLE IF NOT EXISTS usage_monthly (
    month_key   TEXT PRIMARY KEY,
    chars_used  INTEGER NOT NULL DEFAULT 0,
    frozen      INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL
  )
`);

// v2.0.0: TTS 지원 (스키마 변경 없음, 기존 테이블 재사용)
applyMigration('002_tts_support', 'Add TTS support (schema compatible)', (db) => {
  // TTS는 기존 usage_monthly 테이블을 그대로 사용 (Translation + TTS 통합 quota)
  // 스키마 변경 없음, 마이그레이션 기록만 남김
  console.log('  → TTS uses existing quota system (no schema changes)');
});

// v2.1.0: Translation/TTS 사용량 분리 (Google 무료 한도가 별도)
applyMigration('003_separate_api_usage', 'Separate Translation and TTS usage tracking', (db) => {
  console.log('  → Creating new usage_by_api table...');

  // 1. 새 테이블 생성 (API 타입별 사용량 추적)
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_by_api (
      month_key   TEXT NOT NULL,
      api_type    TEXT NOT NULL,
      chars_used  INTEGER NOT NULL DEFAULT 0,
      frozen      INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (month_key, api_type)
    )
  `);

  // 2. 기존 데이터 마이그레이션 (모두 'translation'으로 간주)
  const oldData = db.prepare('SELECT * FROM usage_monthly').all();
  if (oldData.length > 0) {
    console.log(`  → Migrating ${oldData.length} existing records...`);
    const insert = db.prepare(`
      INSERT OR REPLACE INTO usage_by_api (month_key, api_type, chars_used, frozen, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const row of oldData) {
      // 기존 데이터는 모두 번역으로 간주 (v2.0 이전에는 번역만 있었음)
      insert.run(row.month_key, 'translation', row.chars_used, row.frozen, row.updated_at);
      // TTS 레코드도 0으로 초기화
      insert.run(row.month_key, 'tts', 0, 0, row.updated_at);
    }
  }

  // 3. 기존 테이블 백업 (향후 복원 가능하도록)
  db.exec(`ALTER TABLE usage_monthly RENAME TO usage_monthly_backup_v1`);

  console.log('  → Migration complete: usage_by_api table ready');
});

if (isNewDb) {
  console.log('[Database] Created new SQLite DB:', path.resolve(SQLITE_PATH));
} else {
  console.log('[Database] Loaded existing DB:', path.resolve(SQLITE_PATH));
}

// 적용된 마이그레이션 로그
const migrations = db.prepare('SELECT name, applied_at FROM schema_migrations ORDER BY id').all();
console.log(`[Database] Applied migrations: ${migrations.length}`);
migrations.forEach(m => console.log(`  - ${m.name} (${m.applied_at.split('T')[0]})`));

// ─────────────────────────────────────────────
// DB helper (API 타입별 사용량 관리)
// ─────────────────────────────────────────────
const SELECT_USAGE_BY_API = db.prepare(`
  SELECT month_key, api_type, chars_used AS used, frozen
  FROM usage_by_api WHERE month_key = ? AND api_type = ?
`);

const UPSERT_USAGE_BY_API = db.prepare(`
  INSERT INTO usage_by_api (month_key, api_type, chars_used, frozen, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(month_key, api_type) DO UPDATE SET
    chars_used = excluded.chars_used,
    frozen     = excluded.frozen,
    updated_at = excluded.updated_at
`);

const INCR_USAGE_BY_API = db.prepare(`
  UPDATE usage_by_api
  SET chars_used = chars_used + ?, updated_at = ?
  WHERE month_key = ? AND api_type = ?
`);

const SET_FROZEN_BY_API = db.prepare(`
  UPDATE usage_by_api
  SET frozen = ?, updated_at = ?
  WHERE month_key = ? AND api_type = ?
`);

const SELECT_ALL_USAGE = db.prepare(`
  SELECT api_type, chars_used AS used, frozen
  FROM usage_by_api WHERE month_key = ?
`);

// API 타입별 사용량 조회 (없으면 자동 생성)
function getUsageRow(monthKey, apiType) {
  let r = SELECT_USAGE_BY_API.get(monthKey, apiType);
  if (!r) {
    const now = new Date().toISOString();
    UPSERT_USAGE_BY_API.run(monthKey, apiType, 0, 0, now);
    r = SELECT_USAGE_BY_API.get(monthKey, apiType);
  }
  return r;
}

// 사용량 증가
function addUsage(monthKey, apiType, delta) {
  INCR_USAGE_BY_API.run(delta, new Date().toISOString(), monthKey, apiType);
}

// 동결 상태 설정
function setFrozen(monthKey, apiType, frozenBool) {
  SET_FROZEN_BY_API.run(frozenBool ? 1 : 0, new Date().toISOString(), monthKey, apiType);
}

// 월 롤오버 확인 (두 API 타입 모두 초기화)
function rolloverIfMonthChanged(currentKey) {
  const r1 = SELECT_USAGE_BY_API.get(currentKey, 'translation');
  const r2 = SELECT_USAGE_BY_API.get(currentKey, 'tts');
  const now = new Date().toISOString();

  if (!r1) UPSERT_USAGE_BY_API.run(currentKey, 'translation', 0, 0, now);
  if (!r2) UPSERT_USAGE_BY_API.run(currentKey, 'tts', 0, 0, now);
}

// 모든 API 사용량 조회
function getAllUsage(monthKey) {
  const rows = SELECT_ALL_USAGE.all(monthKey);
  const result = {
    translation: { used: 0, frozen: 0 },
    tts: { used: 0, frozen: 0 }
  };

  rows.forEach(r => {
    if (r.api_type === 'translation' || r.api_type === 'tts') {
      result[r.api_type] = { used: r.used, frozen: r.frozen };
    }
  });

  return result;
}

// ─────────────────────────────────────────────
// 앱(Express)
// ─────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');

// CORS 미들웨어
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (ALLOWED_ORIGINS.length === 0) {
    // ALLOWED_ORIGINS가 비어있으면 모든 origin 허용
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    // 허용된 origin만 응답
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Token');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24시간

  // Preflight 요청 처리
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

app.use(express.json({ limit: '256kb' }));
app.use(morgan('combined'));

// 토큰 검증: /translate 에만 적용할 헬퍼
function requireAppToken(req) {
  if (!APP_TOKEN) return null;
  const token = (req.headers['x-app-token'] || '').toString();
  if (token !== APP_TOKEN) return { error: 'unauthorized' };
  return null;
}

// 헬스체크(키만 확인)
app.get('/healthz', (_req, res) => {
  const errs = [];
  try { loadGoogleApiKey(); } catch (e) { errs.push(e.message); }
  if (errs.length) return res.status(500).json({ ok: false, errors: errs });
  return res.type('text/plain').send('ok');
});

// 월 사용량 조회(공개) - API별 개별 조회
app.get('/usage', (_req, res) => {
  try {
    const monthKey = getMonthKeyPST();
    rolloverIfMonthChanged(monthKey);
    const usage = getAllUsage(monthKey);

    res.json({
      month_key: monthKey,
      translation: {
        used: usage.translation.used,
        limit: TRANSLATE_FREE_LIMIT,
        remaining: Math.max(0, TRANSLATE_FREE_LIMIT - usage.translation.used),
        threshold_pct: TRANSLATE_FREEZE_PCT,
        frozen: !!usage.translation.frozen,
        unit: 'characters'
      },
      tts: {
        used: usage.tts.used,
        limit: TTS_FREE_LIMIT,
        remaining: Math.max(0, TTS_FREE_LIMIT - usage.tts.used),
        threshold_pct: TTS_FREEZE_PCT,
        frozen: !!usage.tts.frozen,
        unit: 'characters'
      }
    });
  } catch (e) {
    console.error('usage_error:', e?.message || e);
    res.status(500).json({ error: 'usage_failed' });
  }
});

// 번역 프록시(v2)
app.post('/translate', async (req, res) => {
  // 토큰 검사
  const authErr = requireAppToken(req);
  if (authErr) return res.status(401).json(authErr);

  try {
    let { text, source = 'ko', target = 'lo' } = req.body || {};
    if (text === undefined || text === null) {
      return res.status(400).json({ error: "Missing 'text'" });
    }
    const contents = Array.isArray(text) ? text.map(String) : [String(text)];

    // API 키 로드
    let apiKey;
    try { apiKey = loadGoogleApiKey(); }
    catch (e) { return res.status(500).json({ error: e.message }); }

    // PST 기준 월키 갱신 & Translation API 사용량 로딩
    const monthKey = getMonthKeyPST();
    rolloverIfMonthChanged(monthKey);
    const row = getUsageRow(monthKey, 'translation');
    const used = Number(row.used || 0);
    const frozen = !!row.frozen;

    // 이번 요청 문자수(과금 기준: 전송한 모든 문자)
    const reqChars = countCharsBatch(contents);

    // Translation API 임계 확인
    const hitsThreshold =
      used * 100 >= TRANSLATE_FREE_LIMIT * TRANSLATE_FREEZE_PCT ||
      (used + reqChars) * 100 >= TRANSLATE_FREE_LIMIT * TRANSLATE_FREEZE_PCT;

    if (frozen || hitsThreshold) {
      setFrozen(monthKey, 'translation', true);
      return res.status(429).json({
        error: '🇰🇷 이번 달 번역 무료 사용량을 모두 사용했습니다.\n🇱🇦 ຂ້ອຍໄດ້ໃຊ້ປະລິມານການແປພາສາຟຣີຂອງເດືອນນີ້ໝົດແລ້ວ.',
        code: 'TRANSLATION_FREE_TIER_EXHAUSTED',
        api_type: 'translation'
      });
    }

    // Google Translation v2 (API Key)
    // POST https://translation.googleapis.com/language/translate/v2?key=API_KEY
    const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`;
    const body = {
      q: contents,             // 배열로 전달
      source,                  // 원문 언어 (생략 시 언어감지: q만 주고 source 빼도 동작)
      target,                  // 목표 언어
      format: 'text'           // 또는 'html'
    };

    let resp, data, ok = false;
    for (let i = 0; i < 3; i++) {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body)
      });
      if (resp.ok) { ok = true; break; }
      if (resp.status === 429 || resp.status >= 500) {
        await new Promise(r => setTimeout(r, 400 * Math.pow(2, i)));
        continue;
      }
      break;
    }
    if (!ok) {
      const txt = await resp.text().catch(() => '');
      return res
        .status(resp?.status || 502)
        .json({ error: 'google_api_error', detail: txt.slice(0, 500) });
    }
    data = await resp.json().catch(() => ({}));

    // 성공 시 Translation API 사용량 적산
    addUsage(monthKey, 'translation', reqChars);

    // v2 응답: data.data.translations[{ translatedText, detectedSourceLanguage? }]
    const translations = (data?.data?.translations || []).map(t => t.translatedText || '');

    return res.json({
      translations,
      cached: false,
      metered_chars: reqChars,
      month_key: monthKey,
      api_type: 'translation',
      used_after: getUsageRow(monthKey, 'translation').used,
      limit: TRANSLATE_FREE_LIMIT
    });
  } catch (e) {
    console.error('translate_error:', e?.message || e);
    return res.status(500).json({ error: 'translate_failed' });
  }
});

// TTS 프록시 (Text-to-Speech v1 API)
app.post('/tts', async (req, res) => {
  // 토큰 검사
  const authErr = requireAppToken(req);
  if (authErr) return res.status(401).json(authErr);

  try {
    let {
      text,
      languageCode = 'ko-KR',
      voiceName,
      ssmlGender = 'NEUTRAL',
      audioEncoding = 'MP3',
      speakingRate = 1.0,
      pitch = 0.0,
      volumeGainDb = 0.0
    } = req.body || {};

    if (!text) {
      return res.status(400).json({ error: "Missing 'text'" });
    }
    const textStr = String(text);

    // API 키 로드
    let apiKey;
    try { apiKey = loadGoogleApiKey(); }
    catch (e) { return res.status(500).json({ error: e.message }); }

    // PST 기준 월키 갱신 & TTS API 사용량 로딩
    const monthKey = getMonthKeyPST();
    rolloverIfMonthChanged(monthKey);
    const row = getUsageRow(monthKey, 'tts');
    const used = Number(row.used || 0);
    const frozen = !!row.frozen;

    // 이번 요청 문자수 (TTS는 입력 텍스트 기준)
    const reqChars = countCharsCodePoint(textStr);

    // TTS API 임계 확인
    const hitsThreshold =
      used * 100 >= TTS_FREE_LIMIT * TTS_FREEZE_PCT ||
      (used + reqChars) * 100 >= TTS_FREE_LIMIT * TTS_FREEZE_PCT;

    if (frozen || hitsThreshold) {
      setFrozen(monthKey, 'tts', true);
      return res.status(429).json({
        error: '🇰🇷 이번 달 음성합성 무료 사용량을 모두 사용했습니다.\n🇱🇦 ຂ້ອຍໄດ້ໃຊ້ປະລິມານການສັງເຄາະສຽງຟຣີຂອງເດືອນນີ້ໝົດແລ້ວ.',
        code: 'TTS_FREE_TIER_EXHAUSTED',
        api_type: 'tts'
      });
    }

    // Google Cloud Text-to-Speech v1 API
    // POST https://texttospeech.googleapis.com/v1/text:synthesize?key=API_KEY
    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`;
    const body = {
      input: { text: textStr },
      voice: {
        languageCode,
        ...(voiceName ? { name: voiceName } : {}),
        ssmlGender
      },
      audioConfig: {
        audioEncoding,
        speakingRate,
        pitch,
        volumeGainDb
      }
    };

    let resp, data, ok = false;
    for (let i = 0; i < 3; i++) {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body)
      });
      if (resp.ok) { ok = true; break; }
      if (resp.status === 429 || resp.status >= 500) {
        await new Promise(r => setTimeout(r, 400 * Math.pow(2, i)));
        continue;
      }
      break;
    }
    if (!ok) {
      const txt = await resp.text().catch(() => '');
      return res
        .status(resp?.status || 502)
        .json({ error: 'google_tts_api_error', detail: txt.slice(0, 500) });
    }
    data = await resp.json().catch(() => ({}));

    // 성공 시 TTS API 사용량 적산
    addUsage(monthKey, 'tts', reqChars);

    // v1 응답: { audioContent: "base64-encoded-bytes" }
    const audioContent = data?.audioContent || '';

    return res.json({
      audioContent,
      metered_chars: reqChars,
      month_key: monthKey,
      api_type: 'tts',
      used_after: getUsageRow(monthKey, 'tts').used,
      limit: TTS_FREE_LIMIT,
      audioEncoding
    });
  } catch (e) {
    console.error('tts_error:', e?.message || e);
    return res.status(500).json({ error: 'tts_failed' });
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`[translate-api] listening on :${PORT}`);
  console.log(`Server domain: ${SERVER_DOMAIN}`);
  console.log(`DB: ${path.resolve(SQLITE_PATH)}`);
  if (ALLOWED_ORIGINS.length > 0) {
    console.log(`CORS allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  } else {
    console.log('CORS: Allow all origins (*)');
  }
});

process.on('unhandledRejection', (reason) => console.error('unhandledRejection:', reason));
process.on('uncaughtException', (err) => console.error('uncaughtException:', err));

