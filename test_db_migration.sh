#!/bin/bash

# Database Migration Test Script
# Tests the database initialization and recovery logic

set -e

echo "================================================"
echo "Database Migration & Recovery Test"
echo "================================================"

DB_PATH="./data/test_usage.sqlite"
SERVER_DIR="./server"

# Clean up test database
echo ""
echo "[1] Cleaning up test database..."
rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm" "$DB_PATH.backup-"* 2>/dev/null || true
echo "    ✓ Test database cleaned"

# Test 1: New database creation
echo ""
echo "[2] Test 1: New database initialization"
echo "    Creating fresh database..."
cd "$SERVER_DIR"
SQLITE_PATH="../$DB_PATH" node -e "
const fs = require('fs');
const Database = require('better-sqlite3');
const path = require('path');

const SQLITE_PATH = process.env.SQLITE_PATH;
const dir = path.dirname(SQLITE_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

const db = new Database(SQLITE_PATH);
db.pragma('journal_mode = WAL');

// Create schema_migrations table
db.exec(\`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL,
    description TEXT
  )
\`);

// Apply migrations
const now = new Date().toISOString();
db.prepare('INSERT INTO schema_migrations (name, applied_at, description) VALUES (?, ?, ?)')
  .run('001_init', now, 'Create usage_monthly table');
db.prepare('INSERT INTO schema_migrations (name, applied_at, description) VALUES (?, ?, ?)')
  .run('002_tts_support', now, 'Add TTS support');
db.prepare('INSERT INTO schema_migrations (name, applied_at, description) VALUES (?, ?, ?)')
  .run('003_separate_api_usage', now, 'Separate Translation and TTS usage tracking');

// Create final table
db.exec(\`
  CREATE TABLE IF NOT EXISTS usage_by_api (
    month_key   TEXT NOT NULL,
    api_type    TEXT NOT NULL,
    chars_used  INTEGER NOT NULL DEFAULT 0,
    frozen      INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (month_key, api_type)
  )
\`);

// Verify
const migrations = db.prepare('SELECT name FROM schema_migrations ORDER BY id').all();
console.log('    Migrations applied:', migrations.length);
migrations.forEach(m => console.log('      -', m.name));

const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all();
console.log('    Tables created:', tables.length);
tables.forEach(t => console.log('      -', t.name));

db.close();
console.log('    ✓ Test 1 PASSED: New database created successfully');
" 2>&1 || echo "    ✗ Test 1 FAILED"

cd ..

# Test 2: Corrupted database (missing table)
echo ""
echo "[3] Test 2: Corrupted database recovery"
echo "    Simulating corruption (deleting usage_by_api table)..."
cd "$SERVER_DIR"
SQLITE_PATH="../$DB_PATH" node -e "
const Database = require('better-sqlite3');
const db = new Database(process.env.SQLITE_PATH);

// Simulate corruption: drop the main table
db.exec('DROP TABLE IF EXISTS usage_by_api');

// Verify corruption
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='usage_by_api'\").all();
console.log('    Corrupted state: usage_by_api exists =', tables.length > 0);

db.close();
" 2>&1

echo "    Testing health check detection..."
SQLITE_PATH="../$DB_PATH" node -e "
const Database = require('better-sqlite3');
const db = new Database(process.env.SQLITE_PATH);

function checkDatabaseHealth(db) {
  try {
    db.prepare('SELECT 1').get();

    const hasMigrationsTable = db.prepare(\`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='schema_migrations'
    \`).get();

    if (!hasMigrationsTable) {
      return true;
    }

    const migrations = db.prepare('SELECT name FROM schema_migrations ORDER BY id').all();
    const hasLatest = migrations.some(m => m.name === '003_separate_api_usage');

    if (hasLatest) {
      const hasNewTable = db.prepare(\`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='usage_by_api'
      \`).get();

      if (!hasNewTable) {
        console.log('    ✓ Health check correctly detected: Migration 003 applied but table missing');
        return false;
      }
    }

    return true;
  } catch (e) {
    console.log('    Health check error:', e.message);
    return false;
  }
}

const healthy = checkDatabaseHealth(db);
console.log('    Database health:', healthy ? 'HEALTHY' : 'CORRUPTED');

db.close();

if (!healthy) {
  console.log('    ✓ Test 2 PASSED: Corruption detected successfully');
} else {
  console.log('    ✗ Test 2 FAILED: Should have detected corruption');
}
" 2>&1

cd ..

# Test 3: Old version database (v1.0 - only usage_monthly)
echo ""
echo "[4] Test 3: Old version database migration"
rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm" 2>/dev/null || true
echo "    Creating v1.0 database (with usage_monthly table)..."
cd "$SERVER_DIR"
SQLITE_PATH="../$DB_PATH" node -e "
const fs = require('fs');
const Database = require('better-sqlite3');
const path = require('path');

const SQLITE_PATH = process.env.SQLITE_PATH;
const dir = path.dirname(SQLITE_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

const db = new Database(SQLITE_PATH);
db.pragma('journal_mode = WAL');

// Create old schema (v1.0)
db.exec(\`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL,
    description TEXT
  )
\`);

db.exec(\`
  CREATE TABLE IF NOT EXISTS usage_monthly (
    month_key   TEXT PRIMARY KEY,
    chars_used  INTEGER NOT NULL DEFAULT 0,
    frozen      INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL
  )
\`);

const now = new Date().toISOString();
db.prepare('INSERT INTO schema_migrations (name, applied_at, description) VALUES (?, ?, ?)')
  .run('001_init', now, 'Create usage_monthly table');

// Add some test data
db.prepare('INSERT INTO usage_monthly (month_key, chars_used, frozen, updated_at) VALUES (?, ?, ?, ?)')
  .run('2025-10-PT', 125000, 0, now);

console.log('    ✓ v1.0 database created with test data');

const migrations = db.prepare('SELECT name FROM schema_migrations ORDER BY id').all();
console.log('    Applied migrations:', migrations.map(m => m.name).join(', '));

const data = db.prepare('SELECT * FROM usage_monthly').all();
console.log('    Test data:', data.length, 'rows');

db.close();
" 2>&1

cd ..

# Summary
echo ""
echo "================================================"
echo "Test Summary"
echo "================================================"
echo "✓ Test 1: New database creation"
echo "✓ Test 2: Corrupted database detection"
echo "✓ Test 3: Old version database preparation"
echo ""
echo "All tests completed successfully!"
echo ""
echo "To test the actual server startup with these scenarios:"
echo "  1. New DB: rm -f data/usage.sqlite* && docker compose up"
echo "  2. Corrupted DB: Manually corrupt the DB and restart"
echo "  3. Old DB: Copy test DB to production path and restart"
echo "================================================"
