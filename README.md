# ระบบคลังข้อสอบและตรวจข้อสอบ คณิตศาสตร์ ป.4–6

แบบบ้านอยู่ที่ `SPEC.md` (โฟลเดอร์แม่) · ความคืบหน้าอยู่ที่ `PROGRESS.md`

## โครงสร้าง
| โฟลเดอร์ | หน้าที่ |
|---|---|
| `data/` | ข้อมูลต้นฉบับ (หลักสูตร ระดับ ตั้งค่าเริ่มต้น) — แหล่งความจริงของ seed |
| `supabase/migrations/` | การเปลี่ยนแปลงฐานข้อมูลแบบมีเลขเวอร์ชัน (ห้ามแก้ไฟล์ที่ติดตั้งแล้ว ให้เพิ่มไฟล์ใหม่) |
| `supabase/seed/` | ข้อมูลเริ่มต้น (`S001` สร้างจาก `data/` ด้วย `node scripts/build-seed.mjs`), ข้อหุ่น `S900` |
| `tests/db/` | ทดสอบฐานข้อมูลบน PostgreSQL จำลอง Supabase: `bash tests/db/run.sh` |
| `web/` | หน้าเว็บ (React + TypeScript + Vite) แยกโมดูลใน `src/modules/*` คุยกับข้อมูลผ่าน `src/data/repo.ts` เท่านั้น |

## คำสั่ง (ใน `web/`)
- `npm run test:unit` ทดสอบตรรกะ · `npm run test:e2e` ทดสอบหน้าเว็บโหมดสาธิต (desktop + มือถือ)
- `npm run build` สร้างเว็บจริง (ใช้ `.env.production`) · `npm run build:demo` สร้างโหมดสาธิต

## กติกาการต่อเติม
1. เปลี่ยนฐานข้อมูล = เพิ่ม migration ใหม่ (`0005_...sql`) ที่ขึ้นต้นด้วย `app_begin_migration`
2. ค่าเกณฑ์ใหม่ให้เพิ่มใน `data/settings.default.json` + migration/seed ไม่ hardcode ในโค้ด
3. ทุกโมดูลมีชุดทดสอบ รันทดสอบทั้งหมดผ่านก่อน deploy (GitHub Actions ทำให้อัตโนมัติ)
