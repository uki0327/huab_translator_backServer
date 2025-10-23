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
const FREE_LIMIT = Number(process.env.FREE_TIER_LIMIT_CHARS || 500000);
const FREEZE_PCT = Number(process.env.FREE_TIER_FREEZE_THRESHOLD_PCT || 98);
const SQLITE_PATH = process.env.SQLITE_PATH || './data/usage.sqlite';
const APP_TOKEN = (process.env.APP_TOKEN || '').trim();

const GOOGLE_API_KEY_FILE = process.env.GOOGLE_API_KEY_FILE || '';
const GOOGLE_API_KEY_ENV = process.env.GOOGLE_API_KEY || '';

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
// SQLite 초기화
// ─────────────────────────────────────────────
ensureParentDir(SQLITE_PATH);
const isNewDb = !fs.existsSync(SQLITE_PATH);
const db = new Database(SQLITE_PATH);
ensureFilePerm600(SQLITE_PATH);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
  )
`);
function hasMigration(name) {
  return !!db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(name);
}
function applyMigration(name, sql) {
  if (hasMigration(name)) return;
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(name, now);
  });
  tx();
}
applyMigration('001_init', `
  CREATE TABLE IF NOT EXISTS usage_monthly (
    month_key   TEXT PRIMARY KEY,
    chars_used  INTEGER NOT NULL DEFAULT 0,
    frozen      INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL
  )
`);
if (isNewDb) console.log('SQLite DB 생성:', path.resolve(SQLITE_PATH));

// ─────────────────────────────────────────────
// DB helper
// ─────────────────────────────────────────────
const SELECT_USAGE = db.prepare(`
  SELECT month_key, chars_used AS used, frozen
  FROM usage_monthly WHERE month_key = ?
`);
const UPSERT_USAGE = db.prepare(`
  INSERT INTO usage_monthly (month_key, chars_used, frozen, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(month_key) DO UPDATE SET
    chars_used = excluded.chars_used,
    frozen     = excluded.frozen,
    updated_at = excluded.updated_at
`);
const INCR_USAGE = db.prepare(`
  UPDATE usage_monthly
  SET chars_used = chars_used + ?, updated_at = ?
  WHERE month_key = ?
`);
const SET_FROZEN = db.prepare(`
  UPDATE usage_monthly
  SET frozen = ?, updated_at = ?
  WHERE month_key = ?
`);

function getUsageRow(monthKey) {
  let r = SELECT_USAGE.get(monthKey);
  if (!r) {
    const now = new Date().toISOString();
    UPSERT_USAGE.run(monthKey, 0, 0, now);
    r = SELECT_USAGE.get(monthKey);
  }
  return r;
}
function addUsage(monthKey, delta) {
  INCR_USAGE.run(delta, new Date().toISOString(), monthKey);
}
function setFrozen(monthKey, frozenBool) {
  SET_FROZEN.run(frozenBool ? 1 : 0, new Date().toISOString(), monthKey);
}
function rolloverIfMonthChanged(currentKey) {
  const r = SELECT_USAGE.get(currentKey);
  if (!r) {
    UPSERT_USAGE.run(currentKey, 0, 0, new Date().toISOString());
  }
}

// ─────────────────────────────────────────────
// 앱(Express)
// ─────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');
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

// 월 사용량 조회(공개)
app.get('/usage', (_req, res) => {
  try {
    const monthKey = getMonthKeyPST();
    rolloverIfMonthChanged(monthKey);
    const { used, frozen } = getUsageRow(monthKey);
    res.json({
      month_key: monthKey,
      used,
      limit: FREE_LIMIT,
      remaining: Math.max(0, FREE_LIMIT - used),
      threshold_pct: FREEZE_PCT,
      frozen: !!frozen,
      unit: 'characters'
    });
  } catch {
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

    // PST 기준 월키 갱신 & 사용량 로딩
    const monthKey = getMonthKeyPST();
    rolloverIfMonthChanged(monthKey);
    const row = getUsageRow(monthKey);
    const used = Number(row.used || 0);
    const frozen = !!row.frozen;

    // 이번 요청 문자수(과금 기준: 전송한 모든 문자)
    const reqChars = countCharsBatch(contents);

    // 96% 임계 확인(이미 동결이거나, 이번 요청 포함 시 96% 이상이면 즉시 차단)
    const hitsThreshold =
      used * 100 >= FREE_LIMIT * FREEZE_PCT ||
      (used + reqChars) * 100 >= FREE_LIMIT * FREEZE_PCT;

    if (frozen || hitsThreshold) {
      setFrozen(monthKey, true);
      return res.status(429).json({
        error: '🇰🇷 이번 달 무료 사용량을 모두 사용했습니다.\n🇱🇦 ຂ້ອຍໄດ້ໃຊ້ປະລິມານໃຊ້ງານຟຣີຂອງເດືອນນີ້ໝົດແລ້ວ.',
        code: 'FREE_TIER_EXHAUSTED'
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

    // 성공 시 사용량 적산
    addUsage(monthKey, reqChars);

    // v2 응답: data.data.translations[{ translatedText, detectedSourceLanguage? }]
    const translations = (data?.data?.translations || []).map(t => t.translatedText || '');

    return res.json({
      translations,
      cached: false,
      metered_chars: reqChars,
      month_key: monthKey,
      used_after: getUsageRow(monthKey).used,
      limit: FREE_LIMIT
    });
  } catch (e) {
    console.error('translate_error:', e?.message || e);
    return res.status(500).json({ error: 'translate_failed' });
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`[translate-api] listening on :${PORT}`);
  console.log(`DB: ${path.resolve(SQLITE_PATH)}`);
});

process.on('unhandledRejection', (reason) => console.error('unhandledRejection:', reason));
process.on('uncaughtException', (err) => console.error('uncaughtException:', err));

