-- ทดสอบเฟส 5: บันทึกผลตรวจ คะแนนคำนวณที่ฐานข้อมูล กฎ §8.3 remark เลขที่ซ้ำ แจกผิดชุด สิทธิ์
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

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@test'),
  ('00000000-0000-0000-0000-00000000000b', 'teacher@test')
on conflict (id) do nothing;
update profiles set role = 'owner' where id = '00000000-0000-0000-0000-00000000000a';
delete from exams; delete from items;
insert into items(id, item_code, owner_id, subject_id, indicator_id, cognitive_level, est_difficulty, current_difficulty, status)
select ('00000000-0000-4000-a000-' || lpad(k::text, 12, '0'))::uuid, 'M-9' || lpad(k::text, 5, '0'),
       '00000000-0000-0000-0000-00000000000a', 'MATH', 'MATH-2560-P4-01', 1, 1, 1, 'reviewed'
from generate_series(1, 20) k;
insert into item_versions(item_id, version, content, answer, qa)
select id, 1, '{"stem":"ข้อทดสอบ","options":["ก","ข","ค","ง"]}'::jsonb, '{"choice":1}'::jsonb,
       '{"passed":true,"errors":[],"warnings":[]}'::jsonb
from items;

-- 20 ข้อ 2 ชุด นักเรียน 4 คน: ชุด 1 เฉลย 1,2,3,4,1,… · ชุด 2 เรียงข้อกลับด้าน เฉลย 2,3,4,1,2,… (ต่างทุกตำแหน่ง)
create or replace function pg_temp.oo(k int) returns jsonb language sql as $$
  select case k % 4 when 0 then '[1,2,3,4]'::jsonb when 1 then '[2,1,3,4]'::jsonb when 2 then '[2,3,1,4]'::jsonb else '[2,3,4,1]'::jsonb end
$$;
create or replace function pg_temp.plan() returns jsonb language sql as $$
  with it as (select id, row_number() over (order by item_code) k from items)
  select jsonb_build_object('title', 'สอบตรวจด้วยกล้อง', 'subject_id', 'MATH', 'grade_id', 'P4', 'set_count', 2, 'student_count', 4,
    'rows', jsonb_build_array(jsonb_build_object('indicator_id', 'MATH-2560-P4-01', 'difficulty', 1, 'count', 20)),
    'items', (select jsonb_agg(jsonb_build_object('item_id', id, 'version', 1, 'base_position', k) order by k) from it),
    'sets', jsonb_build_array(
      jsonb_build_object('set_no', 1, 'entries', (select jsonb_agg(jsonb_build_object('item_id', id, 'option_order', pg_temp.oo((k - 1)::int)) order by k) from it)),
      jsonb_build_object('set_no', 2, 'entries', (select jsonb_agg(jsonb_build_object('item_id', id, 'option_order', pg_temp.oo((20 - k + 1)::int)) order by k desc) from it))))
$$;
-- คำตอบตามเฉลยของชุด (ถูกหมด)
create or replace function pg_temp.keys(s int) returns jsonb language sql as $$
  select jsonb_agg(((p - 1 + (s - 1)) % 4) + 1 order by p) from generate_series(1, 20) p
$$;
set client_min_messages = notice;

select pg_temp.ok(exists (select 1 from app_migrations where version = '0008'), 'บันทึก migration 0008');
select pg_temp.ok((select count(*) from app_settings where key like 'scan.%') = 6, 'ตั้งค่าการตรวจ 6 ค่า');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
create temp table e as select public.exam_create(pg_temp.plan()) as id;
select pg_temp.ok((select set_no from exam_seats where exam_id = (select id from e) and seat_no = 2) = 2, 'เลขที่ 2 ได้ชุด 2');
reset role;
select pg_temp.ok(public.scan_keys((select id from e), 1) = array[1,2,3,4,1,2,3,4,1,2,3,4,1,2,3,4,1,2,3,4]
                  and public.scan_keys((select id from e), 2) = array[2,3,4,1,2,3,4,1,2,3,4,1,2,3,4,1,2,3,4,1],
                  'เฉลยรายชุดตรงกับลำดับตัวเลือกที่สลับ');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

-- บันทึกครั้งแรก
create temp table r1 as select public.scan_save_response((select id from e), 1, 1, pg_temp.keys(1)) as v;
select pg_temp.ok((select v->>'status' from r1) = 'saved' and (select (v->'response'->>'score')::int from r1) = 20, 'บันทึกเลขที่ 1 ได้ 20/20');
select pg_temp.ok((select status from exams where id = (select id from e)) = 'open' and (select opened_at from exams where id = (select id from e)) is not null,
                  'เริ่มตรวจแล้วชุดเปลี่ยนเป็น "เปิด"');
-- สแกนซ้ำผลเดิม
select pg_temp.ok((public.scan_save_response((select id from e), 1, 1, pg_temp.keys(1)))->>'status' = 'unchanged', 'สแกนเลขที่ซ้ำ ผลเดิม → unchanged');
-- สแกนซ้ำผลต่าง ไม่เขียนทับ
create temp table r2 as select public.scan_save_response((select id from e), 1, 1, jsonb_set(pg_temp.keys(1), '{0}', '4')) as v;
select pg_temp.ok((select v->>'status' from r2) = 'exists' and (select (v->>'new_score')::int from r2) = 19
                  and (select score from responses where exam_id = (select id from e) and seat_no = 1) = 20,
                  'สแกนเลขที่ซ้ำแต่คำตอบต่าง → exists ไม่เขียนทับ (บอกคะแนนใหม่)');
create temp table r3 as select public.scan_save_response((select id from e), 1, 1, jsonb_set(pg_temp.keys(1), '{0}', '4'), '{}', 'camera', true) v;
select pg_temp.ok((select v->>'status' from r3) = 'replaced'
                  and (select score from responses where exam_id = (select id from e) and seat_no = 1) = 19, 'ครูเลือกแทนที่ → replaced คะแนนใหม่');

-- กฎ §8.3: ฝนหลายช่อง/ไม่ฝน = 0 + remark ข้อกำกวม
select public.scan_save_response((select id from e), 3, 1,
  jsonb_set(jsonb_set(pg_temp.keys(1), '{0}', '"multi"'), '{1}', 'null'), '{5,2,5}', 'upload');
select pg_temp.ok((select score from responses where exam_id = (select id from e) and seat_no = 3) = 18, 'ฝนหลายช่อง/ไม่ฝน = 0 คะแนน');
select pg_temp.ok((select flags = '[{"type":"ambiguous","positions":[2,5],"resolved":false}]'::jsonb and source = 'upload'
                   from responses where exam_id = (select id from e) and seat_no = 3), 'remark ข้อกำกวม (เรียง/ไม่ซ้ำ) + แหล่งข้อมูล');
select pg_temp.fails($q$select public.scan_save_response((select id from e), 4, 2, pg_temp.keys(2), '{21}')$q$, 'ลำดับข้อที่กำกวม', 'ปฏิเสธลำดับข้อกำกวมเกินจำนวนข้อ');

-- แจกผิดชุด: เลขที่ 2 (ชุด 2) แต่ตอบตามเฉลยชุด 1
select public.scan_save_response((select id from e), 2, 2, pg_temp.keys(1));
select pg_temp.ok((select score < 10 and flags @> '[{"type":"wrong_set","suggested_set":1,"score_alt":20,"resolved":false}]'::jsonb
                   from responses where exam_id = (select id from e) and seat_no = 2), 'คะแนนต่ำผิดปกติแต่ชุดอื่นได้สูง → remark สงสัยแจกผิดชุด');
select pg_temp.ok((select not (flags @> '[{"type":"wrong_set"}]'::jsonb) from responses where exam_id = (select id from e) and seat_no = 1),
                  'ตอบตามชุดตัวเอง → ไม่แจ้งแจกผิดชุด');
-- ครูยืนยันให้ตรวจด้วยชุด 1
select public.scan_review_response((select id from e), 2, 1, pg_temp.keys(1));
select pg_temp.ok((select score = 20 and set_no = 1 and flags @> '[{"type":"wrong_set","resolved":true}]'::jsonb
                   from responses where exam_id = (select id from e) and seat_no = 2), 'ครูยืนยันตรวจด้วยชุดอื่น → คะแนนใหม่ remark ปิดแล้ว');
select public.scan_review_response((select id from e), 3, 1, jsonb_set(pg_temp.keys(1), '{0}', '"multi"'));
select pg_temp.ok((select score = 19 and not exists (select 1 from jsonb_array_elements(flags) f where f->>'resolved' = 'false')
                   from responses where exam_id = (select id from e) and seat_no = 3), 'ครูแก้คำตอบข้อกำกวม → remark ปิดแล้ว');
select pg_temp.fails($q$select public.scan_review_response((select id from e), 4, 2, pg_temp.keys(2))$q$, 'ยังไม่ได้ตรวจ', 'แก้เลขที่ที่ยังไม่ตรวจไม่ได้');

-- ตรวจความถูกต้องของข้อมูล
select pg_temp.fails($q$select public.scan_save_response((select id from e), 1, 2, pg_temp.keys(2), '{}', 'camera', true)$q$, 'ชุดที่ 2 แต่เลขที่ 1 ได้ชุดที่ 1', 'QR ชุดไม่ตรงกับเลขที่ → ปฏิเสธ');
select pg_temp.fails($q$select public.scan_save_response((select id from e), 9, 1, pg_temp.keys(1))$q$, 'ไม่มีเลขที่ 9', 'เลขที่ที่ไม่มีในชุด → ปฏิเสธ');
select pg_temp.fails($q$select public.scan_save_response((select id from e), 4, 2, '[1,2,3]'::jsonb)$q$, 'ต้องมี 20 ข้อ', 'จำนวนข้อไม่ครบ → ปฏิเสธ');
select pg_temp.fails($q$select public.scan_save_response((select id from e), 4, 2, jsonb_set(pg_temp.keys(2), '{3}', '5'))$q$, 'ต้องเป็น 1–4', 'ตัวเลือก 5 → ปฏิเสธ');
select pg_temp.fails($q$select public.scan_save_response((select id from e), 4, 2, pg_temp.keys(2), '{}', 'fax')$q$, 'แหล่งข้อมูล', 'แหล่งข้อมูลแปลก → ปฏิเสธ');
-- เขียนตารางตรงด้วยคะแนนปลอม → ฐานข้อมูลคำนวณใหม่
insert into responses(exam_id, seat_no, set_no, answers, score) values ((select id from e), 4, 2, pg_temp.keys(2), 999);
select pg_temp.ok((select score from responses where exam_id = (select id from e) and seat_no = 4) = 20, 'คะแนนคำนวณที่ฐานข้อมูลเสมอ (ไม่เชื่อคะแนนที่ส่งมา)');

select pg_temp.ok((select jsonb_agg((x->>'seat_no')::int) from jsonb_array_elements(public.scan_responses((select id from e))) x) = '[1,2,3,4]'::jsonb,
                  'รายการผลตรวจเรียงตามเลขที่');
select pg_temp.fails($q$select public.exam_delete((select id from e))$q$, '', 'ชุดที่มีผลตรวจแล้วลบไม่ได้');
select public.scan_delete_response((select id from e), 4);
select pg_temp.ok(not exists (select 1 from responses where exam_id = (select id from e) and seat_no = 4), 'ลบผลตรวจเลขที่ 4 เพื่อสแกนใหม่');
select pg_temp.fails($q$select public.scan_keys((select id from e), 1)$q$, 'permission denied', 'ผู้ใช้เรียกดูเฉลยตรง ๆ ไม่ได้ (scan_keys)');

-- ครูอื่น / ผู้ไม่ล็อกอิน
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.fails($q$select public.scan_save_response((select id from e), 4, 2, pg_temp.keys(2))$q$, 'ไม่พบชุดข้อสอบ', 'ครูอื่นบันทึกผลตรวจชุดของคนอื่นไม่ได้');
select pg_temp.fails($q$select public.scan_responses((select id from e))$q$, 'ไม่พบชุดข้อสอบ', 'ครูอื่นดูผลตรวจของคนอื่นไม่ได้');
select pg_temp.fails($q$select public.scan_delete_response((select id from e), 1)$q$, 'ไม่พบชุดข้อสอบ', 'ครูอื่นลบผลตรวจของคนอื่นไม่ได้');
select pg_temp.ok((select count(*) from responses) = 0, 'ครูอื่นมองไม่เห็นผลตรวจ (RLS)');
reset role;
set role anon;
select pg_temp.fails($q$select public.scan_responses('00000000-0000-0000-0000-000000000000')$q$, 'permission denied', 'ผู้ไม่ล็อกอินเรียกไม่ได้');
reset role;

-- ปิดชุดแล้วบันทึกไม่ได้
update exams set status = 'closed' where id = (select id from e);
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.fails($q$select public.scan_save_response((select id from e), 4, 2, pg_temp.keys(2))$q$, 'ปิดแล้ว', 'ชุดที่ปิดแล้วบันทึกผลตรวจไม่ได้');
select pg_temp.fails($q$select public.scan_delete_response((select id from e), 1)$q$, 'ปิดแล้ว', 'ชุดที่ปิดแล้วลบผลตรวจไม่ได้');
reset role;

delete from exams;
delete from items;
\echo ALL PHASE 5 DB TESTS PASSED
