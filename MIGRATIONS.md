# Database Migrations Guide

이 문서는 Huab Translator Proxy Server의 데이터베이스 스키마 마이그레이션 시스템을 설명합니다.

## 📋 개요

- **목적**: 데이터 손실 없이 스키마 업데이트
- **방식**: Sequential migration with version tracking
- **DB**: SQLite3 with WAL mode
- **안전성**: Transaction-based, rollback on failure

## 🔄 마이그레이션 시스템

### 자동 실행
서버 시작 시 자동으로 미적용된 마이그레이션을 순서대로 실행합니다.

```javascript
// 서버 시작 시 자동 실행:
// 1. schema_migrations 테이블 확인
// 2. 미적용 마이그레이션 찾기
// 3. 순서대로 트랜잭션 내에서 실행
// 4. 성공 시 마이그레이션 기록 저장
```

### 적용된 마이그레이션 확인
서버 로그에서 확인 가능:
```
[Database] Applied migrations: 2
  - 001_init (2025-10-26)
  - 002_tts_support (2025-10-26)
```

SQL로 직접 확인:
```sql
SELECT * FROM schema_migrations ORDER BY id;
```

## 📝 마이그레이션 히스토리

### 001_init (v1.0.0)
**설명**: 초기 스키마 생성
**변경사항**:
- `usage_monthly` 테이블 생성
  - `month_key`: PST 기준 월 키 (예: 2025-10-PT)
  - `chars_used`: 사용된 문자 수
  - `frozen`: 차단 여부 (0/1)
  - `updated_at`: 최종 업데이트 시각

**데이터 영향**: 없음 (신규 설치)

### 002_tts_support (v2.0.0)
**설명**: Text-to-Speech API 지원 추가
**변경사항**:
- 스키마 변경 없음
- 기존 `usage_monthly` 테이블 재사용 (Translation + TTS 통합 quota)
- 마이그레이션 기록만 추가

**데이터 영향**: 없음 (기존 데이터 유지, 스키마 호환)

**중요**: v1.0.0에서 v2.0.0으로 업그레이드 시 기존 사용량 데이터가 **그대로 유지**됩니다.

## 🛠️ 새 마이그레이션 추가 방법

### 1. 마이그레이션 파일 위치
`server/index.js`의 "마이그레이션 정의" 섹션에 추가

### 2. 작성 예제

#### SQL 방식 (단순한 DDL)
```javascript
applyMigration('003_add_api_logs', 'Add API request logs table', `
  CREATE TABLE IF NOT EXISTS api_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL,
    status INTEGER NOT NULL,
    chars INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_api_logs_created_at ON api_logs(created_at);
`);
```

#### 함수 방식 (복잡한 데이터 마이그레이션)
```javascript
applyMigration('004_split_usage_by_api', 'Split usage tracking by API type', (db) => {
  // 1. 새 테이블 생성
  db.exec(`
    CREATE TABLE usage_by_api (
      month_key TEXT NOT NULL,
      api_type TEXT NOT NULL,
      chars_used INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (month_key, api_type)
    )
  `);

  // 2. 기존 데이터 마이그레이션
  const oldData = db.prepare('SELECT * FROM usage_monthly').all();
  const insert = db.prepare(`
    INSERT INTO usage_by_api (month_key, api_type, chars_used, updated_at)
    VALUES (?, ?, ?, ?)
  `);

  for (const row of oldData) {
    // Translation으로 간주 (기존 데이터는 모두 번역)
    insert.run(row.month_key, 'translation', row.chars_used, row.updated_at);
  }

  // 3. 필요시 기존 테이블 백업
  db.exec(`ALTER TABLE usage_monthly RENAME TO usage_monthly_backup`);
});
```

### 3. 명명 규칙
- **형식**: `{숫자}_?{설명}` (예: `003_add_api_logs`)
- **숫자**: 3자리 연속 번호 (001, 002, 003...)
- **설명**: snake_case, 영문 소문자

### 4. 주의사항
⚠️ **절대 하지 말 것**:
- 이미 적용된 마이그레이션 수정
- 마이그레이션 순서 변경
- 마이그레이션 삭제

✅ **권장 사항**:
- `CREATE TABLE IF NOT EXISTS` 사용
- `ALTER TABLE` 전 백업 테이블 생성
- 트랜잭션 내에서 실행되므로 실패 시 자동 롤백
- 복잡한 마이그레이션은 함수 방식 사용
- 데이터 변환 시 기존 테이블 백업

## 🔍 마이그레이션 실패 처리

### 실패 시나리오
마이그레이션이 실패하면:
1. 트랜잭션이 자동 롤백됨
2. 서버 시작이 중단됨
3. 에러 로그 출력

### 복구 방법

#### 1. 로그 확인
```
[Migration] Failed: 003_add_api_logs Error: table api_logs already exists
```

#### 2. 수동 확인
```sql
-- 적용된 마이그레이션 확인
SELECT * FROM schema_migrations;

-- 문제 있는 마이그레이션 삭제 (주의!)
DELETE FROM schema_migrations WHERE name = '003_add_api_logs';
```

#### 3. 코드 수정 후 재시작
마이그레이션 SQL 수정 후 서버 재시작

## 📊 데이터 백업

### 자동 백업 (권장)
Docker volume을 통해 `./data` 디렉토리 전체 백업:
```bash
# 백업
docker compose down
cp -r data data.backup.$(date +%Y%m%d)

# 복원
docker compose down
rm -rf data
mv data.backup.20251026 data
docker compose up -d
```

### 수동 백업
```bash
# SQLite DB 파일 백업
cp data/usage.sqlite data/usage.sqlite.backup

# 복원
cp data/usage.sqlite.backup data/usage.sqlite
```

## 🧪 테스트 시나리오

### 신규 설치
1. `data/` 디렉토리 삭제
2. 서버 시작
3. 모든 마이그레이션이 순서대로 실행됨

### v1.0.0 → v2.0.0 업그레이드
1. v1.0.0 DB 파일 준비 (001_init만 적용된 상태)
2. v2.0.0 코드로 서버 시작
3. 002_tts_support 마이그레이션만 실행됨
4. 기존 데이터 그대로 유지

### 롤백
마이그레이션 자체는 롤백을 지원하지 않습니다.
백업에서 복원하는 방식을 권장합니다.

## 📚 참고

- [Better SQLite3 Documentation](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [SQLite ALTER TABLE](https://www.sqlite.org/lang_altertable.html)
- [Database Migration Best Practices](https://www.prisma.io/dataguide/types/relational/migration-strategies)
