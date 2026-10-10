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
| `web/src/modules/bank/figure/` | ตัววาดรูปจากข้อกำหนด (SVG ตามสัดส่วนจริง) — เพิ่มชนิดรูป: `spec.ts` + `layout.ts` + `forms.ts` + `samples.ts` |
| `web/src/modules/assembly/` | ประกอบชุดข้อสอบ: `assemble.ts` (เลือก/เรียง/สลับ/สมดุลเฉลย), `validate.ts` (ตัวตรวจกฎ §6 อิสระ), `serverRules.ts` (กฎเดียวกับฐานข้อมูล สำหรับโหมดสาธิต) |
| `web/src/modules/print/` | เอกสารพิมพ์: `model.ts` (ข้อมูลรายชุด), `PrintViews.tsx` (หน้าพิมพ์/PDF), `docx.ts` (Word), `answerSheetSvg.ts` + `template.ts` (กระดาษคำตอบ ตามแบบ `data/answer_sheet_template_v1.json`) |
| `web/src/modules/scan/` | ตรวจกระดาษคำตอบ (เฟส 5): `omr.ts` (QR → มุมดำ → จัดภาพตรง → วัดความเข้มวง), `grade.ts` (กฎ §8.3 + แจกผิดชุด), `session.ts` (กันเฟรมเบลอ), `ScanPage.tsx` (กล้อง/อัปโหลด/ผลตรวจ), ทำงานใน Web Worker — ภาพไม่ออกจากเครื่อง |
| `web/src/modules/analysis/` | วิเคราะห์และปิดชุด (เฟส 6): `analyze.ts` (p, r เทคนิค 27%, ตัวลวง, รายตัวชี้วัด, ภาพรวมห้อง — กฎเดียวกับ migration 0009), `report.ts` + `xlsx.ts` (ไฟล์ Excel รายงาน), `ReportPage.tsx` (รายงาน/พิมพ์ PDF), `ClosePage.tsx` (ปิดชุด), `expiry.tsx` (หมดอายุ/แจ้งเตือนล่วงหน้า) |
| `web/src/modules/calibration/` | ปรับความยาก (เฟส 7): `calibrate.ts` (กฎ §11 ย้ายระดับ n ≥ 50 กันชน ±0.05, ป้าย r — กฎเดียวกับ migration 0010 `calib_decide` เทียบเป็นจำนวนเต็ม), `fromDb.ts` (แปลงผลจากฐานข้อมูล), `HealthPage.tsx` (หน้าสุขภาพคลัง), `ItemCalibrationPanel.tsx` (สถิติ/ประวัติการย้ายรายข้อ) — ฐานข้อมูลปรับเองทุกครั้งที่บันทึกสถิติจากการปิดชุด (ทริกเกอร์บน item_stat_rounds) |
| `web/tests/unit/scan/` | ภาพจำลองกระดาษคำตอบที่รู้คำตอบ (`synth.ts`: เอียง เงา แสงน้อย เบลอ ฝนจาง) · ทดสอบหนัก: `SCAN_STRESS=200 npx vitest run tests/unit/scan/stress.test.ts` |
| `tests/db/fixtures/` | แผนชุดข้อสอบที่สร้างด้วยอัลกอริทึมจริง ให้ฐานข้อมูลทดสอบรับ (สร้างใหม่: `UPDATE_FIXTURE=1 npx vitest run tests/unit/assembly-fixture.test.ts`) · ผลวิเคราะห์ที่หน้าเว็บคำนวณ ให้ฐานข้อมูลคำนวณเทียบ (`UPDATE_FIXTURE=1 npx vitest run tests/unit/analysis-fixture.test.ts`) |
| `tests/db/fixtures/phase7_calibration.json` | กรณีขอบ + จำลองสอบหลายรอบ ให้ฐานข้อมูลเดินตามทีละรอบเทียบกับหน้าเว็บ (สร้างใหม่: `UPDATE_FIXTURE=1 npx vitest run tests/unit/calibration-fixture.test.ts`) |
| `supabase/bundle/` | ไฟล์รวมสำหรับวางใน SQL Editor ของ Supabase ทีละเฟส |

## คำสั่ง (ใน `web/`)
- `npm run test:unit` ทดสอบตรรกะ · `npm run test:e2e` ทดสอบหน้าเว็บโหมดสาธิต (desktop + มือถือ)
- `npm run build` สร้างเว็บจริง (ใช้ `.env.production`) · `npm run build:demo` สร้างโหมดสาธิต

## กติกาการต่อเติม
1. เปลี่ยนฐานข้อมูล = เพิ่ม migration ใหม่ (`0010_...sql`) ที่ขึ้นต้นด้วย `app_begin_migration`
2. ค่าเกณฑ์ใหม่ให้เพิ่มใน `data/settings.default.json` + migration/seed ไม่ hardcode ในโค้ด
3. ทุกโมดูลมีชุดทดสอบ รันทดสอบทั้งหมดผ่านก่อน deploy (GitHub Actions ทำให้อัตโนมัติ)
