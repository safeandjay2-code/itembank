-- ทดสอบเฟส 1: โครงสร้าง ข้อมูลอ้างอิง ทริกเกอร์ และสิทธิ์ (RLS)
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'PASS: %', msg;
end $$;
set client_min_messages = notice;

-- ===== 1) ข้อมูลอ้างอิง =====
select pg_temp.ok((select count(*) from indicators where grade_id='P4' and kind='terminal') = 10, 'ป.4 มีตัวชี้วัดปลายทาง 10 ตัว');
select pg_temp.ok((select count(*) from indicators where grade_id='P5' and kind='terminal') = 10, 'ป.5 มีตัวชี้วัดปลายทาง 10 ตัว');
select pg_temp.ok((select count(*) from indicators where grade_id='P6' and kind='terminal') = 13, 'ป.6 มีตัวชี้วัดปลายทาง 13 ตัว');
select pg_temp.ok((select count(*) from indicators where kind='interim') = 0, 'ไม่มีตัวชี้วัดต้นทางในระบบ');
select pg_temp.ok((select count(distinct code) from indicators) = 33, 'รหัสตัวชี้วัดไม่ซ้ำ 33 รหัส');
select pg_temp.ok((select string_agg(key, ',' order by id) from difficulty_levels) = 'easy,medium,hard,challenge', 'ความยาก 4 ระดับ เรียงง่ายไปท้าทาย');
select pg_temp.ok((select count(*) from cognitive_levels) = 4, 'ระดับการคิด 4 ระดับ');
select pg_temp.ok((select (value)::int from app_settings where key='bank.items_per_level_target') = 20, 'ตั้งค่าเป้า 20 ข้อต่อระดับ');
select pg_temp.ok((select value #>> '{}' from app_settings where key='print.page_size') = 'A4', 'ตั้งค่ากระดาษ A4');
select pg_temp.ok((select count(*) from app_migrations where version in ('0001','0002','0003','0004','S001')) = 5, 'บันทึก migration เฟส 1 ครบ 5 รายการ (0001–0004 + S001)');

-- migration รันซ้ำต้องถูกปฏิเสธ
do $$ begin
  perform public.app_begin_migration('0002', 'dup');
  raise exception 'FAIL: migration ซ้ำไม่ถูกปฏิเสธ';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: migration ที่ติดตั้งแล้วรันซ้ำไม่ได้';
end $$;

-- ===== 2) ผู้ใช้และบทบาท =====
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@test'),
  ('00000000-0000-0000-0000-00000000000b', 'teacher@test');
select pg_temp.ok((select count(*) from profiles) = 2, 'สร้างโปรไฟล์อัตโนมัติเมื่อมีผู้ใช้ใหม่');
select pg_temp.ok((select count(*) from profiles where role = 'teacher') = 2, 'ผู้ใช้ใหม่ได้บทบาท teacher เป็นค่าเริ่มต้น');
update profiles set role = 'owner' where id = '00000000-0000-0000-0000-00000000000a';

-- ===== 3) ข้อหุ่น =====
\i supabase/seed/S900_dev_sample_items.sql
select pg_temp.ok((select count(*) from items where is_sample) = 264, 'สร้างข้อหุ่น 264 ข้อ (33×4×2)');
select pg_temp.ok((select count(*) from bank_coverage) = 132, 'ผังความครบมี 132 ช่อง (33×4)');
select pg_temp.ok((select min(ready_count) from bank_coverage) = 2, 'ทุกช่องมีข้อพร้อมใช้ 2 ข้อ');
select pg_temp.ok((select count(*) from items where item_code !~ '^M-[0-9]{6}$') = 0, 'รหัสข้อรูปแบบ M-000000 ทุกข้อ');
select pg_temp.ok((select count(*) from item_events where event_type='created') = 264, 'บันทึกเหตุการณ์สร้างข้อครบ');

-- รหัสข้อเปลี่ยนไม่ได้
do $$ begin
  update items set item_code = 'M-999999' where item_code = 'M-000001';
  raise exception 'FAIL: เปลี่ยนรหัสข้อได้';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: รหัสประจำข้อเปลี่ยนไม่ได้';
end $$;

-- ย้ายระดับความยากแล้วบันทึกประวัติ
update items set current_difficulty = 2 where item_code = 'M-000001';
select pg_temp.ok((select count(*) from item_events e join items i on i.id=e.item_id
                   where i.item_code='M-000001' and e.event_type='difficulty_changed') = 1,
                  'ย้ายระดับความยากแล้วมีประวัติ และรหัสข้อยังเหมือนเดิม');
update items set current_difficulty = 1 where item_code = 'M-000001';

-- สถิติสะสม (ถ่วงน้ำหนัก)
insert into item_stat_rounds(item_id, version, grade_id, n, n_correct, r)
select id, 1, 'P4', 20, 16, 0.40 from items where item_code='M-000001';
insert into item_stat_rounds(item_id, version, grade_id, n, n_correct, r)
select id, 1, 'P4', 30, 12, 0.20 from items where item_code='M-000001';
select pg_temp.ok((select n from item_stats where item_code='M-000001') = 50, 'สถิติรวม n = 50');
select pg_temp.ok((select p from item_stats where item_code='M-000001') = 0.560, 'ค่า p รวม = 28/50 = 0.560');
select pg_temp.ok((select r from item_stats where item_code='M-000001') = 0.280, 'ค่า r ถ่วงน้ำหนัก = 0.280');

-- ขึ้นเวอร์ชันใหม่ สถิติเริ่มนับใหม่
insert into item_versions(item_id, version, content, answer, change_note)
select id, 2, content, answer, 'ทดสอบเปลี่ยนตัวเลข' from item_versions v join items i on i.id = v.item_id
where i.item_code = 'M-000001' and v.version = 1;
update items set current_version = 2 where item_code = 'M-000001';
select pg_temp.ok((select n from item_stats where item_code='M-000001') = 0, 'ขึ้นเวอร์ชันใหม่แล้วสถิติเริ่มนับใหม่');

-- ===== 4) สิทธิ์ (RLS) =====
-- 4.1 ผู้ไม่ล็อกอิน
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok((select count(*) from items) = 0, 'anon มองไม่เห็นข้อสอบ');
select pg_temp.ok((select count(*) from indicators) = 0, 'anon มองไม่เห็นตัวชี้วัด');
reset role;

-- 4.2 ครูทั่วไป (teacher)
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.ok((select count(*) from indicators) = 33, 'teacher อ่านตัวชี้วัดได้');
select pg_temp.ok((select count(*) from items) = 0, 'teacher มองไม่เห็นคลังข้อสอบของเจ้าของ');
select pg_temp.ok((select count(*) from item_versions) = 0, 'teacher มองไม่เห็นเนื้อหา/เฉลย');
do $$ begin
  update profiles set role = 'owner' where id = '00000000-0000-0000-0000-00000000000b';
  raise exception 'FAIL: teacher ตั้งตัวเองเป็น owner ได้';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: teacher เปลี่ยนบทบาทตัวเองไม่ได้';
end $$;
do $$ begin
  update app_settings set value = '99' where key = 'bank.items_per_level_target';
  if (select (value)::int from app_settings where key='bank.items_per_level_target') = 99 then
    raise exception 'FAIL: teacher แก้ตั้งค่าได้';
  end if;
  raise notice 'PASS: teacher แก้ตั้งค่าระบบไม่ได้';
end $$;
insert into exams(title, subject_id, grade_id, item_count) values ('ชุดของครู B', 'MATH', 'P4', 10);
select pg_temp.ok((select count(*) from exams) = 1, 'teacher สร้างชุดข้อสอบของตัวเองได้');
reset role;

-- 4.3 เจ้าของระบบ (owner)
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.ok((select count(*) from items) = 264, 'owner เห็นคลังข้อสอบทั้งหมด');
insert into exams(title, subject_id, grade_id, item_count) values ('ชุดของ owner', 'MATH', 'P5', 20);
reset role;

-- 4.4 teacher ต้องไม่เห็นชุดของ owner
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.ok((select count(*) from exams) = 1 and (select title from exams limit 1) = 'ชุดของครู B',
                  'teacher เห็นเฉพาะชุดข้อสอบของตัวเอง');
reset role;
select set_config('request.jwt.claim.sub', '', false);  -- กลับเป็นผู้ดูแลฐานข้อมูล (ไม่มีผู้ใช้)

-- ===== 5) คำตอบในชุดที่ปิดแล้ว =====
insert into exam_seats(exam_id, seat_no, set_no) select id, 1, 1 from exams where title = 'ชุดของ owner';
update exams set status = 'closed' where title = 'ชุดของ owner';
do $$ begin
  insert into responses(exam_id, seat_no, set_no, answers)
  select id, 1, 1, '[1,2,3]'::jsonb from exams where title = 'ชุดของ owner';
  raise exception 'FAIL: บันทึกคำตอบในชุดที่ปิดแล้วได้';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: ชุดที่ปิดแล้วบันทึกคำตอบเพิ่มไม่ได้';
end $$;

-- ===== 6) ลบข้อหุ่น =====
select pg_temp.ok(public.bank_remove_sample_items() = 264, 'ลบข้อหุ่นได้ครบ 264 ข้อ');
select pg_temp.ok((select count(*) from items) = 0, 'หลังลบไม่เหลือข้อหุ่น');

\echo ALL PHASE 1 DB TESTS PASSED
