#!/usr/bin/env bash
# รันทดสอบฐานข้อมูลบน PostgreSQL ในเครื่อง (ฐานข้อมูลใหม่ทุกครั้ง)
# ใช้: bash tests/db/run.sh   (ต้องมี PostgreSQL 15+ และสิทธิ์สร้างฐานข้อมูล)
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=itembank_test
PSQL=${PSQL:-"psql -v ON_ERROR_STOP=1 -X -q"}
dropdb --if-exists $DB
createdb $DB
$PSQL -d $DB -f tests/db/supabase_shim.sql >/dev/null
for f in supabase/migrations/*.sql; do
  echo "migration: $f"
  $PSQL -d $DB -f "$f" >/dev/null
done
echo "seed: S001_reference_data.sql"
$PSQL -d $DB -f supabase/seed/S001_reference_data.sql >/dev/null
for t in tests/db/test_*.sql; do
  echo "test: $t"
  # แสดงเฉพาะผลทดสอบ (PASS/FAIL/ERROR)
  $PSQL -t -d $DB -f "$t" 2>&1 | grep -E "PASS|FAIL|ERROR|PASSED" | sed -E 's/^psql:[^ ]+ (NOTICE|ERROR): +/\1 /'
  if [ "${PIPESTATUS[0]}" -ne 0 ]; then echo "TESTS FAILED: $t"; dropdb $DB; exit 1; fi
done
dropdb $DB
