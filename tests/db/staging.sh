#!/usr/bin/env bash
# ฐานข้อมูลสำเนาทดสอบ (One Stop) — จำลองสภาพเดียวกับระบบจริงก่อนต่อเติม
#   = Supabase จำลอง + migrations ที่ระบบจริงติดตั้งแล้ว (0001–0010) + S001 + ข้อหุ่น S900 (264 ข้อ)
# ใช้:
#   bash tests/db/staging.sh            สร้างฐาน itembank_staging ใหม่ในสภาพระบบจริง (ยังไม่มี migration ใหม่)
#   bash tests/db/staging.sh upgrade    สร้างใหม่ แล้วติดตั้ง migration ที่ใหม่กว่า 0010 ทับ (ซ้อมติดตั้งจริง) + รันซ้ำต้องขึ้น "ติดตั้งไปแล้ว"
# ฐานนี้ไม่ถูกลบหลังรัน เปิดดูได้ด้วย psql -d itembank_staging
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=itembank_staging
LIVE_LAST=0010   # migration ล่าสุดที่ติดตั้งบนระบบจริงแล้ว — แก้เลขนี้ทุกครั้งที่ปล่อยขึ้นระบบจริง
PSQL=${PSQL:-"psql -v ON_ERROR_STOP=1 -X -q"}
dropdb --if-exists $DB
createdb $DB
$PSQL -d $DB -f tests/db/supabase_shim.sql >/dev/null
for f in supabase/migrations/*.sql; do
  n=$(basename "$f" | cut -c1-4)
  if [[ "$n" > "$LIVE_LAST" ]]; then continue; fi
  $PSQL -d $DB -f "$f" >/dev/null
done
$PSQL -d $DB -f supabase/seed/S001_reference_data.sql >/dev/null
$PSQL -d $DB >/dev/null <<'SQL'
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000aa', 'owner@staging.local');
update public.profiles set role = 'owner' where id = '00000000-0000-0000-0000-0000000000aa';
SQL
$PSQL -d $DB -f supabase/seed/S900_dev_sample_items.sql >/dev/null
echo "สภาพระบบจริง: $($PSQL -t -A -d $DB -c "select string_agg(version, ',' order by version) from public.app_migrations") · ข้อหุ่น $($PSQL -t -A -d $DB -c "select count(*) from public.items")"
if [[ "${1:-}" == "upgrade" ]]; then
  for f in supabase/migrations/*.sql; do
    n=$(basename "$f" | cut -c1-4)
    if [[ "$n" > "$LIVE_LAST" ]]; then
      echo "ติดตั้งทับ: $f"
      $PSQL -d $DB -f "$f" >/dev/null
      if $PSQL -d $DB -f "$f" >/dev/null 2>&1; then echo "ผิดพลาด: รัน $f ซ้ำแล้วไม่ถูกปฏิเสธ"; exit 1; fi
      echo "  รันซ้ำ: ถูกปฏิเสธ (ติดตั้งไปแล้ว) ✓"
    fi
  done
  echo "หลังติดตั้ง: $($PSQL -t -A -d $DB -c "select string_agg(version, ',' order by version) from public.app_migrations") · ข้อหุ่น $($PSQL -t -A -d $DB -c "select count(*) from public.items")"
fi
