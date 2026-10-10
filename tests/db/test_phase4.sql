-- ทดสอบเฟส 4: เวลาสอบ/ชื่อบนหัวกระดาษ, แบบกระดาษคำตอบรุ่น 1, ความจุ 45 ข้อ, exam_get คืนข้อมูลสำหรับพิมพ์
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'PASS: %', msg;
end $$;
create or replace function pg_temp.fails(sql text, pattern text, msg text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlerrm not ilike '%' || pattern || '%' then
      raise exception 'FAIL: % (ผิดพลาดแต่ข้อความไม่ตรง: %)', msg, sqlerrm;
    end if;
    raise notice 'PASS: %', msg;
    return;
  end;
  raise exception 'FAIL: % (ไม่เกิดข้อผิดพลาด)', msg;
end $$;

-- คลังจำลอง: 50 ข้อในตัวชี้วัดเดียว ระดับง่าย (พอทดสอบความจุ 45)
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@test'),
  ('00000000-0000-0000-0000-00000000000b', 'teacher@test')
on conflict (id) do nothing;
update profiles set role = 'owner' where id = '00000000-0000-0000-0000-00000000000a';
delete from exams; delete from items;
insert into items(id, item_code, owner_id, subject_id, indicator_id, cognitive_level, est_difficulty, current_difficulty, status)
select ('00000000-0000-4000-a000-' || lpad(k::text, 12, '0'))::uuid, 'M-8' || lpad(k::text, 5, '0'),
       '00000000-0000-0000-0000-00000000000a', 'MATH', 'MATH-2560-P4-01', 1, 1, 1, 'reviewed'
from generate_series(1, 50) k;
insert into item_versions(item_id, version, content, answer, qa)
select id, 1, '{"stem":"ผลบวกของ 3/4 กับ 1/8 เท่ากับเท่าใด","options":["7/8","4/12","1 1/8","5/8"]}'::jsonb, '{"choice":1}'::jsonb,
       '{"passed":true,"errors":[],"warnings":[]}'::jsonb
from items;

-- แผนชุดเดียว n ข้อ ตัวเลือกเรียงสมดุล (เฉลยต้นฉบับ = 1 → วางเฉลยวนตำแหน่ง 1..4)
create or replace function pg_temp.plan(n int, p_title text default 'แบบทดสอบพิมพ์') returns jsonb language sql as $$
  select jsonb_build_object('title', p_title, 'subject_id', 'MATH', 'grade_id', 'P4', 'set_count', 1, 'student_count', 3,
    'rows', jsonb_build_array(jsonb_build_object('indicator_id', 'MATH-2560-P4-01', 'difficulty', 1, 'count', n)),
    'items', (select jsonb_agg(jsonb_build_object('item_id', id, 'version', 1, 'base_position', k) order by k)
              from (select id, row_number() over (order by item_code) k from items order by item_code limit n) t),
    'sets', jsonb_build_array(jsonb_build_object('set_no', 1, 'entries',
              (select jsonb_agg(jsonb_build_object('item_id', id, 'option_order',
                        case (k - 1) % 4 when 0 then '[1,2,3,4]'::jsonb when 1 then '[2,1,3,4]'::jsonb
                                         when 2 then '[2,3,1,4]'::jsonb else '[2,3,4,1]'::jsonb end) order by k)
               from (select id, row_number() over (order by item_code) k from items order by item_code limit n) t))))
$$;
set client_min_messages = notice;

select pg_temp.ok(exists (select 1 from app_migrations where version = '0007'), 'บันทึก migration 0007');
select pg_temp.ok((select (spec->'bubbles'->>'capacity')::int = 45 and jsonb_array_length(spec->'corner_marks'->'top_left') = 4
                          and spec->'qr'->>'payload' like 'IB1|%' and spec->'paper'->>'size' = 'A5'
                   from answer_sheet_templates where version = 1), 'แบบกระดาษคำตอบรุ่น 1 มีตำแหน่งมุมดำ QR วงกลม ความจุ 45 ข้อ');
select pg_temp.ok((select value from app_settings where key = 'assembly.max_items') = '45'::jsonb
                  and (select value from app_settings where key = 'print.minutes_per_item') = '2'::jsonb, 'ตั้งค่าใหม่ของเฟส 4');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
create temp table e as select public.exam_create(pg_temp.plan(20)) as id;
select pg_temp.ok((select duration_min from exams where id = (select id from e)) = 40, 'เวลาสอบเริ่มต้น = 20 ข้อ × 2 นาที');
select pg_temp.ok((select (d->>'duration_min')::int = 40 and (d->>'template_version')::int = 1 from (select public.exam_get((select id from e)) d) x),
                  'exam_get คืนเวลาสอบและรุ่นแบบกระดาษคำตอบ');
select public.exam_update_meta((select id from e), '  สอบกลางภาค ป.4  ', 60);
select pg_temp.ok((select title = 'สอบกลางภาค ป.4' and duration_min = 60 from exams where id = (select id from e)), 'แก้ชื่อและเวลาสอบได้');
select pg_temp.fails($q$select public.exam_update_meta((select id from e), '', 60)$q$, 'ชื่อแบบทดสอบ', 'ปฏิเสธชื่อว่าง');
select pg_temp.fails($q$select public.exam_update_meta((select id from e), 'x', 0)$q$, 'เวลาสอบต้องอยู่ระหว่าง', 'ปฏิเสธเวลา 0 นาที');
select pg_temp.fails($q$select public.exam_update_meta((select id from e), 'x', 301)$q$, 'เวลาสอบต้องอยู่ระหว่าง', 'ปฏิเสธเวลาเกิน 300 นาที');

create temp table e45 as select public.exam_create(pg_temp.plan(45, 'เต็มความจุ')) as id;
select pg_temp.ok((select item_count from exams where id = (select id from e45)) = 45 and (select duration_min from exams where id = (select id from e45)) = 90,
                  'สร้างชุด 45 ข้อ (เต็มความจุ) ได้');
select pg_temp.fails($q$select public.exam_create(pg_temp.plan(46))$q$, 'เกินความจุกระดาษคำตอบ (45 ข้อ)', 'ปฏิเสธชุด 46 ข้อ');
select pg_temp.ok((select count(*) from exams) = 2, 'ชุดที่ถูกปฏิเสธไม่ทิ้งข้อมูลค้าง');

-- ครูอื่นแก้ชุดของคนอื่นไม่ได้ / ผู้ไม่ล็อกอินเรียกไม่ได้
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.fails($q$select public.exam_update_meta((select id from e), 'แอบแก้', 30)$q$, 'ไม่พบชุดข้อสอบ', 'ครูแก้ชุดของคนอื่นไม่ได้');
reset role;
set role anon;
select pg_temp.fails($q$select public.exam_update_meta('00000000-0000-0000-0000-000000000000', 'x', 30)$q$, 'permission denied', 'ผู้ไม่ล็อกอินแก้ชุดไม่ได้');
reset role;
select pg_temp.ok((select title from exams where id = (select id from e)) = 'สอบกลางภาค ป.4', 'ชื่อชุดไม่ถูกแก้โดยคนอื่น');

delete from exams;
delete from items;
\echo ALL PHASE 4 DB TESTS PASSED
