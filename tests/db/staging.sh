#!/usr/bin/env bash
# ฐานข้อมูลสำเนาทดสอบ (One Stop) — จำลองสภาพเดียวกับระบบจริงก่อนต่อเติม
#   = Supabase จำลอง + migrations ที่ระบบจริงติดตั้งแล้ว (0001–0010) + S001 + ข้อหุ่น S900 (264 ข้อ)
# ใช้:
#   bash tests/db/staging.sh            สร้างฐาน itembank_staging ใหม่ในสภาพระบบจริง (ยังไม่มี migration ใหม่)
#   bash tests/db/staging.sh upgrade    สร้างใหม่ + ใส่ข้อมูลจำลองการใช้งานจริง (staging_before.sql) แล้วติดตั้ง migration ที่ใหม่กว่า LIVE_LAST ทับ
#                                       (ซ้อมติดตั้งจริง) + รันซ้ำต้องขึ้น "ติดตั้งไปแล้ว" + ตรวจข้อมูลเดิม/ทดสอบรวมทั้งเส้นทาง (staging_after.sql)
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
  $PSQL -d $DB -f tests/db/staging_before.sql >/dev/null
  echo "ข้อมูลจำลองการใช้งานจริง: ชุด A เปิดสอบ (ตรวจแล้ว 2 คน) · ชุด B ปิดแล้ว · ชุด C ยังไม่สอบ"
  for f in supabase/migrations/*.sql; do
    n=$(basename "$f" | cut -c1-4)
    if [[ "$n" > "$LIVE_LAST" ]]; then
      echo "ติดตั้งทับ: $f"
      $PSQL -d $DB -f "$f" >/dev/null
      if $PSQL -d $DB -f "$f" >/dev/null 2>&1; then echo "ผิดพลาด: รัน $f ซ้ำแล้วไม่ถูกปฏิเสธ"; exit 1; fi
      echo "  รันซ้ำ: ถูกปฏิเสธ (ติดตั้งไปแล้ว) ✓"
    fi
  done
  $PSQL -d $DB -f tests/db/staging_after.sql 2>&1 | grep -E "PASS|FAIL|ERROR|LINE" | sed -E 's/^psql:[^ ]+ (NOTICE|ERROR): +/\1 /'
  if [ "${PIPESTATUS[0]}" -ne 0 ]; then echo "ผิดพลาด: ตรวจหลังติดตั้งไม่ผ่าน"; exit 1; fi
  echo "หลังติดตั้ง: $($PSQL -t -A -d $DB -c "select string_agg(version, ',' order by version) from public.app_migrations") · ข้อหุ่น $($PSQL -t -A -d $DB -c "select count(*) from public.items")"
fi
