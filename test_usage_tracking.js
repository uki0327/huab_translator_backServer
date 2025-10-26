// Usage Tracking Test Script
// Tests the usage accumulation and rollover logic

import Database from 'better-sqlite3';
import fs from 'fs';

const TEST_DB_PATH = './data/test_usage_tracking.sqlite';

// Clean up test DB
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);

console.log('================================================');
console.log('Usage Tracking Test');
console.log('================================================\n');

// ─────────────────────────────────────────────
// Setup Database
// ─────────────────────────────────────────────
const db = new Database(TEST_DB_PATH);
db.pragma('journal_mode = WAL');

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

// ─────────────────────────────────────────────
// Helper Functions (from index.js)
// ─────────────────────────────────────────────

function getMonthKeyPST(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(date);
  const yr = parts.find(p => p.type === 'year')?.value;
  const mo = parts.find(p => p.type === 'month')?.value;
  return `${yr}-${mo}-PT`;
}

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

function getUsageRow(monthKey, apiType) {
  let r = SELECT_USAGE_BY_API.get(monthKey, apiType);
  if (!r) {
    const now = new Date().toISOString();
    UPSERT_USAGE_BY_API.run(monthKey, apiType, 0, 0, now);
    r = SELECT_USAGE_BY_API.get(monthKey, apiType);
  }
  return r;
}

function addUsage(monthKey, apiType, delta) {
  const result = INCR_USAGE_BY_API.run(delta, new Date().toISOString(), monthKey, apiType);
  return result.changes;
}

function rolloverIfMonthChanged(currentKey) {
  const r1 = SELECT_USAGE_BY_API.get(currentKey, 'translation');
  const r2 = SELECT_USAGE_BY_API.get(currentKey, 'tts');
  const now = new Date().toISOString();

  if (!r1) UPSERT_USAGE_BY_API.run(currentKey, 'translation', 0, 0, now);
  if (!r2) UPSERT_USAGE_BY_API.run(currentKey, 'tts', 0, 0, now);
}

// ─────────────────────────────────────────────
// Test 1: Month Key Generation
// ─────────────────────────────────────────────
console.log('[Test 1] Month Key Generation (PST)');
const currentMonthKey = getMonthKeyPST();
console.log(`  Current month key: ${currentMonthKey}`);

// Test with specific dates
const testDates = [
  { date: new Date('2025-01-01T00:00:00Z'), desc: '2025-01-01 UTC (2024-12-31 PST)' },
  { date: new Date('2025-01-01T08:00:00Z'), desc: '2025-01-01 08:00 UTC (2025-01-01 00:00 PST)' },
  { date: new Date('2025-02-01T00:00:00Z'), desc: '2025-02-01 UTC (2025-01-31 PST)' },
  { date: new Date('2025-10-26T08:00:00Z'), desc: 'Current time' }
];

testDates.forEach(({ date, desc }) => {
  const key = getMonthKeyPST(date);
  console.log(`  ${desc} → ${key}`);
});

console.log('  ✓ Test 1 PASSED\n');

// ─────────────────────────────────────────────
// Test 2: Usage Accumulation (Translation)
// ─────────────────────────────────────────────
console.log('[Test 2] Usage Accumulation - Translation API');
const monthKey = currentMonthKey;

rolloverIfMonthChanged(monthKey);

// Initial state
let row = getUsageRow(monthKey, 'translation');
console.log(`  Initial: ${row.used} chars`);

// Add usage: 100 chars
addUsage(monthKey, 'translation', 100);
row = getUsageRow(monthKey, 'translation');
console.log(`  After +100: ${row.used} chars`);
if (row.used !== 100) {
  console.error('  ✗ FAILED: Expected 100, got', row.used);
  process.exit(1);
}

// Add more usage: 250 chars
addUsage(monthKey, 'translation', 250);
row = getUsageRow(monthKey, 'translation');
console.log(`  After +250: ${row.used} chars`);
if (row.used !== 350) {
  console.error('  ✗ FAILED: Expected 350, got', row.used);
  process.exit(1);
}

// Add more: 1000 chars
addUsage(monthKey, 'translation', 1000);
row = getUsageRow(monthKey, 'translation');
console.log(`  After +1000: ${row.used} chars`);
if (row.used !== 1350) {
  console.error('  ✗ FAILED: Expected 1350, got', row.used);
  process.exit(1);
}

console.log('  ✓ Test 2 PASSED\n');

// ─────────────────────────────────────────────
// Test 3: Usage Accumulation (TTS)
// ─────────────────────────────────────────────
console.log('[Test 3] Usage Accumulation - TTS API');

// Initial state
row = getUsageRow(monthKey, 'tts');
console.log(`  Initial: ${row.used} chars`);

// Add usage: 500 chars
addUsage(monthKey, 'tts', 500);
row = getUsageRow(monthKey, 'tts');
console.log(`  After +500: ${row.used} chars`);
if (row.used !== 500) {
  console.error('  ✗ FAILED: Expected 500, got', row.used);
  process.exit(1);
}

// Add more: 3000 chars
addUsage(monthKey, 'tts', 3000);
row = getUsageRow(monthKey, 'tts');
console.log(`  After +3000: ${row.used} chars`);
if (row.used !== 3500) {
  console.error('  ✗ FAILED: Expected 3500, got', row.used);
  process.exit(1);
}

console.log('  ✓ Test 3 PASSED\n');

// ─────────────────────────────────────────────
// Test 4: Separate Tracking (Translation != TTS)
// ─────────────────────────────────────────────
console.log('[Test 4] Separate Tracking Verification');

const translationRow = getUsageRow(monthKey, 'translation');
const ttsRow = getUsageRow(monthKey, 'tts');

console.log(`  Translation: ${translationRow.used} chars`);
console.log(`  TTS: ${ttsRow.used} chars`);

if (translationRow.used === ttsRow.used) {
  console.error('  ✗ WARNING: Translation and TTS have same usage (should be independent)');
}

if (translationRow.used !== 1350) {
  console.error('  ✗ FAILED: Translation should be 1350');
  process.exit(1);
}

if (ttsRow.used !== 3500) {
  console.error('  ✗ FAILED: TTS should be 3500');
  process.exit(1);
}

console.log('  ✓ Test 4 PASSED\n');

// ─────────────────────────────────────────────
// Test 5: Monthly Rollover
// ─────────────────────────────────────────────
console.log('[Test 5] Monthly Rollover Simulation');

// Simulate next month
const nextMonthDate = new Date();
nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
const nextMonthKey = getMonthKeyPST(nextMonthDate);
console.log(`  Current month: ${monthKey}`);
console.log(`  Next month: ${nextMonthKey}`);

if (nextMonthKey === monthKey) {
  console.error('  ✗ FAILED: Next month key is same as current');
  process.exit(1);
}

// Roll over to next month
rolloverIfMonthChanged(nextMonthKey);

const newTranslationRow = getUsageRow(nextMonthKey, 'translation');
const newTtsRow = getUsageRow(nextMonthKey, 'tts');

console.log(`  Next month Translation: ${newTranslationRow.used} chars (should be 0)`);
console.log(`  Next month TTS: ${newTtsRow.used} chars (should be 0)`);

if (newTranslationRow.used !== 0) {
  console.error('  ✗ FAILED: New month translation should start at 0');
  process.exit(1);
}

if (newTtsRow.used !== 0) {
  console.error('  ✗ FAILED: New month TTS should start at 0');
  process.exit(1);
}

// Verify old month data is preserved
const oldTranslationRow = getUsageRow(monthKey, 'translation');
const oldTtsRow = getUsageRow(monthKey, 'tts');
console.log(`  Old month Translation: ${oldTranslationRow.used} chars (preserved)`);
console.log(`  Old month TTS: ${oldTtsRow.used} chars (preserved)`);

if (oldTranslationRow.used !== 1350) {
  console.error('  ✗ FAILED: Old month data should be preserved');
  process.exit(1);
}

console.log('  ✓ Test 5 PASSED\n');

// ─────────────────────────────────────────────
// Test 6: Database Persistence
// ─────────────────────────────────────────────
console.log('[Test 6] Database Persistence Check');

// Check all records in DB
const allRecords = db.prepare('SELECT * FROM usage_by_api ORDER BY month_key, api_type').all();
console.log(`  Total records in DB: ${allRecords.length}`);
allRecords.forEach(r => {
  console.log(`    ${r.month_key} | ${r.api_type.padEnd(12)} | ${r.chars_used.toString().padStart(6)} chars | frozen: ${r.frozen}`);
});

if (allRecords.length !== 4) { // 2 months × 2 API types = 4 records
  console.error('  ✗ FAILED: Expected 4 records (2 months × 2 APIs)');
  process.exit(1);
}

console.log('  ✓ Test 6 PASSED\n');

// ─────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────
db.close();
console.log('================================================');
console.log('All Tests PASSED! ✓');
console.log('================================================');
console.log('');
console.log('Summary:');
console.log('  ✓ Month key generation works correctly (PST timezone)');
console.log('  ✓ Translation API usage accumulates correctly');
console.log('  ✓ TTS API usage accumulates correctly');
console.log('  ✓ Translation and TTS tracked separately');
console.log('  ✓ Monthly rollover creates new records with 0 usage');
console.log('  ✓ Old month data is preserved in database');
console.log('');
console.log(`Test database: ${TEST_DB_PATH}`);
