#!/usr/bin/env python3
# Supabase เปิด pg_safeupdate กับคำสั่งที่มาจาก API (PostgREST): UPDATE/DELETE ที่ไม่มี WHERE ถูกปฏิเสธ
# ("UPDATE requires a WHERE clause") — ฐานทดสอบในเครื่อง/CI ไม่มีส่วนเสริมนี้ จึงตรวจแบบอ่านโค้ดแทน
# รวมถึงคำสั่งในฟังก์ชัน (ฟังก์ชันที่หน้าเว็บเรียกผ่าน rpc ก็โดนด้วย) · ใช้ "where true" ถ้าตั้งใจแก้ทุกแถว
# ใช้: python3 tests/db/check_safeupdate.py
import pathlib, re, sys

root = pathlib.Path(__file__).resolve().parents[2]
# คำสั่งที่ติดตั้งบนระบบจริงไปแล้วและถูกแทนด้วย migration ที่ใหม่กว่า (ไฟล์เดิมห้ามแก้)
SUPERSEDED = {('0011_gradebook.sql', 'update _gb_cell set value = round(coalesce(adjusted, real), v_digits)'): '0013'}

def statements(sql: str):
    sql = re.sub(r'--[^\n]*', '', sql)
    sql = re.sub(r"'(?:[^']|'')*'", "''", sql)  # ข้อความในเครื่องหมายคำพูดอาจมี ; หรือคำว่า update
    return [s.strip() for s in sql.split(';')]

bad = []
for f in sorted((root / 'supabase/migrations').glob('*.sql')):
    for st in statements(f.read_text(encoding='utf-8')):
        low = ' '.join(st.lower().split())
        m = re.search(r'(?:^|\b(?:begin|then|else|loop|\$\$))\s*((?:update|delete\s+from)\s.*)$', low)
        if not m or low.startswith(('create trigger', 'create policy')):
            continue
        cmd = m.group(1)
        if ' where ' in f' {cmd} ' or cmd.startswith('update of '):
            continue
        if (f.name, cmd) in SUPERSEDED:
            continue
        bad.append(f'{f.name}: {cmd[:120]}')

if bad:
    print('UPDATE/DELETE ไม่มี WHERE (ระบบจริงจะปฏิเสธ "requires a WHERE clause"):')
    print('\n'.join('  ' + b for b in bad))
    sys.exit(1)
print('PASS ไม่มี UPDATE/DELETE ที่ขาด WHERE')
