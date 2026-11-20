-- ทดสอบเฟส 1–9 เดิมเขียนก่อนมีห้อง O-NET (ผู้ใช้ใหม่ได้บทบาท teacher)
-- ตั้งค่าเฉพาะในฐานทดสอบ — ระบบจริงใช้ค่า 'onet' จาก 0015
update public.app_settings set value = '"teacher"'::jsonb where key = 'auth.new_user_role';
select 'PASS: ตั้งผู้ใช้ใหม่ = teacher สำหรับทดสอบเฟสเดิม';
