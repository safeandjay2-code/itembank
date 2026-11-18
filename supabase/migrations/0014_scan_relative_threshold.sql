-- =====================================================================
-- 0014_scan_relative_threshold.sql — เกณฑ์อ่านรอยฝนแบบปรับตามแผ่น (ตรวจด้วยกล้อง/อัปโหลด)
-- ที่มา: ใช้งานจริงครั้งแรก ป.5 (18 พ.ย. 2569) เด็กฝนดินสอเบา 0.13–0.44 แต่เกณฑ์เดิมตายตัว 0.34
--   → remark 155 ข้อจาก 20 แผ่น และฝนหลายช่องถูกเลือกช่องเดียว (ควรได้ 0)
-- หน้าเว็บใช้เกณฑ์ใหม่ (web/src/modules/scan/grade.ts) — ฐานข้อมูลเก็บแค่ค่าตั้งต้นให้ปรับได้
--   ลบ scan.fill_threshold / scan.blank_threshold / scan.multi_gap (ไม่มีโค้ดใดอ่านแล้ว)
--   เพิ่ม scan.mark_floor / mark_ratio / multi_ratio / residue_ratio / faint_band
-- =====================================================================
begin;
select public.app_begin_migration('0014', 'scan: per-sheet relative mark threshold settings');

delete from public.app_settings where key in ('scan.fill_threshold', 'scan.blank_threshold', 'scan.multi_gap');

insert into public.app_settings(key, value, description_th) values
  ('scan.mark_floor', '0.05'::jsonb, 'ตรวจด้วยกล้อง: เกณฑ์ "มีรอยฝน" ขั้นต่ำ (ความเข้มหลังหักพื้นหลัง)'),
  ('scan.mark_ratio', '0.25'::jsonb, 'ตรวจด้วยกล้อง: เกณฑ์ "มีรอยฝน" ของแต่ละแผ่น = สัดส่วนนี้ × ความเข้มรอยฝนตามปกติของแผ่นนั้น'),
  ('scan.multi_ratio', '0.55'::jsonb, 'ตรวจด้วยกล้อง: ช่องที่ 2 เข้ม ≥ สัดส่วนนี้ของช่องเข้มสุด = ฝนหลายช่อง (0 คะแนน)'),
  ('scan.residue_ratio', '0.3'::jsonb, 'ตรวจด้วยกล้อง: ช่องที่ 2 เข้มระหว่างสัดส่วนนี้ถึงเกณฑ์ฝนหลายช่อง = น่าจะลบไม่สะอาด (remark)'),
  ('scan.faint_band', '1.5'::jsonb, 'ตรวจด้วยกล้อง: ช่องเข้มสุดเกินเกณฑ์ไม่ถึงกี่เท่า = จางจนไม่แน่ใจ (remark)')
on conflict (key) do nothing;

commit;
