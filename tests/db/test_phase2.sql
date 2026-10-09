-- ทดสอบเฟส 2: บันทึกข้อ เวอร์ชัน สถานะ ผลตรวจคุณภาพ รายการค้นหา สิทธิ์ และสำรอง/นำเข้า JSON
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'PASS: %', msg;
end $$;
-- ต้องเกิดข้อผิดพลาด และข้อความต้องมี pattern
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
-- ตัวช่วยสร้างข้อมูลข้อ
create or replace function pg_temp.item(p_id uuid, p_stem text, p_opts text[], p_choice int, p_passed boolean,
                                        p_figure jsonb default null, p_est int default 1, p_ind text default 'MATH-2560-P4-01')
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'indicator_id', p_ind, 'item_type', 'mcq4', 'cognitive_level', 'apply', 'est_difficulty', p_est,
    'no_shuffle', false, 'tags', jsonb_build_array('ทดสอบ'), 'subtopic', 'เศษส่วน',
    'content', jsonb_build_object('stem', p_stem, 'options', to_jsonb(p_opts), 'figure', p_figure,
                                  'explanation', 'วิธีคิด', 'distractor_rationale', jsonb_build_array(null, 'a', 'b', 'c'),
                                  'check', null),
    'answer', jsonb_build_object('choice', p_choice),
    'qa', jsonb_build_object('passed', p_passed, 'errors', '[]'::jsonb, 'warnings', '[]'::jsonb))
$$;
set client_min_messages = notice;

-- ===== 0) ผู้ใช้ (ต่อจากเฟส 1) =====
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@test'),
  ('00000000-0000-0000-0000-00000000000b', 'teacher@test')
on conflict (id) do nothing;
update profiles set role = 'owner' where id = '00000000-0000-0000-0000-00000000000a';
delete from items;

select pg_temp.ok(exists (select 1 from app_migrations where version = '0005'), 'บันทึก migration 0005');
select pg_temp.ok((select value from app_settings where key = 'qa.require_answer_check') = 'false'::jsonb, 'มีตั้งค่า qa.require_answer_check');
select pg_temp.ok(public.bank_digits('ผลบวก 3/4 กับ 1,250.5 บาท') = '3|4|1,250.5', 'ลายเซ็นตัวเลขในข้อความ');
select pg_temp.ok(public.bank_digits('12 3') <> public.bank_digits('1 23'), 'ลายเซ็นตัวเลขแยกจำนวนกัน');

-- ===== 1) owner สร้างและแก้ข้อ =====
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

create temp table t_ids(name text primary key, id uuid);
insert into t_ids select 'q1', public.bank_save_item(pg_temp.item(null, 'จงหาผลบวก 3/4 + 1/8', array['7/8','4/12','1 1/8','5/8'], 1, true), 'new');
select pg_temp.ok((select status from items where id = (select id from t_ids where name='q1')) = 'draft', 'ข้อใหม่เป็นร่าง');
select pg_temp.ok((select item_code ~ '^M-[0-9]{6}$' and current_version = 1 and subtopic = 'เศษส่วน' and tags = '{ทดสอบ}'
                   and cognitive_level = 3 and current_difficulty = 1 from items where id = (select id from t_ids where name='q1')),
                  'ข้อใหม่ได้รหัส M-000000 เวอร์ชัน 1 พร้อมข้อมูลครบ');
select pg_temp.ok((select (qa->>'passed')::boolean from item_versions where item_id = (select id from t_ids where name='q1')), 'เก็บผลตรวจคุณภาพไว้กับเวอร์ชัน');

-- สถานะ: ผ่านตรวจ → ตั้ง "ตรวจแล้ว" ได้
select public.bank_set_status((select id from t_ids where name='q1'), 'reviewed', 'ครูตรวจแล้ว');
select pg_temp.ok((select status from items where id = (select id from t_ids where name='q1')) = 'reviewed', 'ผ่านตรวจอัตโนมัติ → ตั้งเป็นตรวจแล้วได้');
select pg_temp.ok(exists (select 1 from item_events where item_id = (select id from t_ids where name='q1') and event_type = 'note'), 'บันทึกหมายเหตุการเปลี่ยนสถานะ');

-- ไม่ผ่านตรวจ → ตั้ง "ตรวจแล้ว" ไม่ได้
insert into t_ids select 'q2', public.bank_save_item(pg_temp.item(null, 'ข้อที่ยังมีปัญหา', array['1','2','3','4'], 2, false), 'new');
select pg_temp.fails(format('select public.bank_set_status(%L, ''reviewed'')', (select id from t_ids where name='q2')),
                     'ยังไม่ผ่านการตรวจอัตโนมัติ', 'ไม่ผ่านตรวจอัตโนมัติ → ตั้งเป็นตรวจแล้วไม่ได้');
select pg_temp.fails(format('select public.bank_set_status(%L, ''active'')', (select id from t_ids where name='q2')),
                     'ยังไม่ผ่านการตรวจอัตโนมัติ', 'ไม่ผ่านตรวจอัตโนมัติ → ตั้งเป็นใช้งานไม่ได้');
select public.bank_set_status((select id from t_ids where name='q2'), 'retired');
select pg_temp.ok((select status from items where id = (select id from t_ids where name='q2')) = 'retired', 'ตั้งเป็นเลิกใช้ได้เสมอ');

-- แก้คำผิด (ตัวเลขเดิม) = เวอร์ชันเดิม สถานะคงเดิม
select public.bank_save_item(pg_temp.item((select id from t_ids where name='q1'), 'จงหาผลบวกของ 3/4 และ 1/8', array['7/8','4/12','1 1/8','5/8'], 1, true), 'minor', 'แก้คำ');
select pg_temp.ok((select current_version = 1 and status = 'reviewed' from items where id = (select id from t_ids where name='q1')), 'แก้คำผิด: เวอร์ชันเดิม สถานะคงเดิม');
select pg_temp.ok((select content->>'stem' from item_versions where item_id = (select id from t_ids where name='q1') and version = 1) = 'จงหาผลบวกของ 3/4 และ 1/8', 'แก้คำผิด: เนื้อหาเวอร์ชัน 1 ถูกแก้');
select pg_temp.ok(exists (select 1 from item_events where item_id = (select id from t_ids where name='q1') and event_type = 'version_edited'), 'แก้คำผิด: มีประวัติ');

-- แก้แบบเวอร์ชันเดิมแต่ตัวเลข/เฉลย/รูปเปลี่ยน → ถูกปฏิเสธ
select pg_temp.fails(format('select public.bank_save_item(%L::jsonb, ''minor'')',
  pg_temp.item((select id from t_ids where name='q1'), 'จงหาผลบวกของ 3/4 และ 1/6', array['7/8','4/12','1 1/8','5/8'], 1, true)),
  'ตัวเลขในโจทย์เปลี่ยน', 'แก้ตัวเลขในโจทย์ต้องขึ้นเวอร์ชันใหม่');
select pg_temp.fails(format('select public.bank_save_item(%L::jsonb, ''minor'')',
  pg_temp.item((select id from t_ids where name='q1'), 'จงหาผลบวกของ 3/4 และ 1/8', array['7/8','4/12','1 1/8','5/8'], 2, true)),
  'เปลี่ยนเฉลย', 'เปลี่ยนเฉลยต้องขึ้นเวอร์ชันใหม่');
select pg_temp.fails(format('select public.bank_save_item(%L::jsonb, ''minor'')',
  pg_temp.item((select id from t_ids where name='q1'), 'จงหาผลบวกของ 3/4 และ 1/8', array['7/8','4/12','1 1/8','3/8'], 1, true)),
  'ตัวเลือก 4', 'แก้ตัวเลขในตัวเลือกต้องขึ้นเวอร์ชันใหม่');
select pg_temp.fails(format('select public.bank_save_item(%L::jsonb, ''minor'')',
  pg_temp.item((select id from t_ids where name='q1'), 'จงหาผลบวกของ 3/4 และ 1/8', array['7/8','4/12','1 1/8','5/8'], 1, true, '{"kind":"square","s":2}')),
  'รูปเปลี่ยน', 'เพิ่ม/แก้รูปต้องขึ้นเวอร์ชันใหม่');

-- แก้คำผิดแล้วไม่ผ่านตรวจ (ข้อที่ตรวจแล้ว) → ต้องแก้
select public.bank_save_item(pg_temp.item((select id from t_ids where name='q1'), 'จงหาผลบวกของ 3/4 และ 1/8', array['7/8','4/12','1 1/8','5/8'], 1, false), 'minor');
select pg_temp.ok((select status from items where id = (select id from t_ids where name='q1')) = 'needs_fix', 'แก้แล้วไม่ผ่านตรวจ → สถานะต้องแก้');

-- สถิติของเวอร์ชัน 1 แล้วขึ้นเวอร์ชันใหม่
reset role;
insert into item_stat_rounds(item_id, version, grade_id, n, n_correct, r)
select id, 1, 'P4', 40, 30, 0.35 from t_ids where name = 'q1';
set role authenticated;
select pg_temp.ok((select n from item_stats where item_id = (select id from t_ids where name='q1')) = 40, 'เวอร์ชัน 1 มีสถิติ n = 40');
select public.bank_save_item(pg_temp.item((select id from t_ids where name='q1'), 'จงหาผลบวกของ 2/3 และ 1/6', array['5/6','3/9','1 1/6','1/2'], 1, true, null, 3), 'major', 'เปลี่ยนตัวเลข');
select pg_temp.ok((select current_version = 2 and status = 'draft' from items where id = (select id from t_ids where name='q1')), 'แก้สาระสำคัญ: ขึ้นเวอร์ชัน 2 และกลับเป็นร่าง');
select pg_temp.ok((select n from item_stats where item_id = (select id from t_ids where name='q1')) = 0, 'เวอร์ชันใหม่เริ่มนับสถิติใหม่');
select pg_temp.ok((select count(*) from item_versions where item_id = (select id from t_ids where name='q1')) = 2, 'เวอร์ชันเก่ายังเก็บไว้');
select pg_temp.ok((select change_note from item_versions where item_id = (select id from t_ids where name='q1') and version = 2) = 'เปลี่ยนตัวเลข', 'บันทึกเหตุผลของเวอร์ชัน');
select pg_temp.ok((select est_difficulty = 3 and current_difficulty = 1 from items where id = (select id from t_ids where name='q1')),
                  'มีสถิติแล้ว: เปลี่ยนความยากคาดการณ์ไม่ย้ายความยากปัจจุบัน (รอวงจรปรับความยาก)');
select pg_temp.ok(exists (select 1 from item_events where item_id = (select id from t_ids where name='q1') and event_type = 'meta_changed'), 'เปลี่ยนข้อมูลกำกับมีประวัติ');

-- ข้อที่ยังไม่มีสถิติ: ความยากปัจจุบันตามค่าคาดการณ์
select public.bank_save_item(pg_temp.item((select id from t_ids where name='q2'), 'ข้อที่ยังมีปัญหา', array['1','2','3','4'], 2, false, null, 4), 'minor');
select pg_temp.ok((select current_difficulty from items where id = (select id from t_ids where name='q2')) = 4, 'ไม่มีสถิติ: ความยากปัจจุบันตามค่าคาดการณ์');

-- ตรวจโครงสร้างขั้นต่ำ
select pg_temp.fails(format('select public.bank_save_item(%L::jsonb, ''new'')', pg_temp.item(null, '', array['1','2','3','4'], 1, true)), 'ยังไม่มีโจทย์', 'ไม่มีโจทย์บันทึกไม่ได้');
select pg_temp.fails(format('select public.bank_save_item(%L::jsonb, ''new'')', pg_temp.item(null, 'x', array['1','2','3'], 1, true)), 'ตัวเลือก 4 ตัว', 'ตัวเลือกไม่ครบ 4 บันทึกไม่ได้');
select pg_temp.fails(format('select public.bank_save_item(%L::jsonb, ''new'')', pg_temp.item(null, 'x', array['1','2','3','4'], 5, true)), 'เฉลยต้องเป็น', 'เฉลยนอกช่วงบันทึกไม่ได้');
select pg_temp.fails(format('select public.bank_save_item(%L::jsonb, ''new'')', pg_temp.item(null, 'x', array['1','2','3','4'], 1, true, null, 1, 'NOPE')), 'ไม่พบตัวชี้วัด', 'ตัวชี้วัดไม่มีจริงบันทึกไม่ได้');
select pg_temp.fails(format('select public.bank_save_item(%L::jsonb, ''new'')', jsonb_set(pg_temp.item(null, 'x', array['1','2','3','4'], 1, true), '{item_type}', '"numeric"')), 'ยังไม่เปิดใช้งาน', 'ประเภทข้อที่ยังไม่เปิดใช้บันทึกไม่ได้');

-- รายการค้นหา
insert into t_ids select 'q3', public.bank_save_item(pg_temp.item(null, 'จากรูป พื้นที่เท่าใด', array['12','14','16','18'], 3, true, '{"kind":"rectangle","w":4,"h":4}', 2, 'MATH-2560-P5-01'), 'new');
select pg_temp.ok((select count(*) from bank_item_list) = 3, 'รายการค้นหาเห็นทุกข้อของเจ้าของ');
select pg_temp.ok((select stem from bank_item_list where id = (select id from t_ids where name='q1')) = 'จงหาผลบวกของ 2/3 และ 1/6', 'รายการแสดงโจทย์ของเวอร์ชันปัจจุบัน');
select pg_temp.ok((select has_figure and grade_id = 'P5' and qa_passed from bank_item_list where id = (select id from t_ids where name='q3')), 'รายการบอกว่ามีรูป ชั้น และผลตรวจ');
select pg_temp.ok((select count(*) from bank_item_list where stem ilike '%พื้นที่%') = 1, 'ค้นหาจากข้อความโจทย์ได้');
select pg_temp.ok((select draft_count from bank_coverage where indicator_id = 'MATH-2560-P5-01' and difficulty_id = 2) = 1, 'ผังความครบนับข้อร่าง');

-- ลบข้อ
select pg_temp.fails(format('select public.bank_delete_item(%L)', (select id from t_ids where name='q2')), 'เฉพาะข้อที่เป็นร่าง', 'ข้อที่ไม่ใช่ร่างลบไม่ได้');
select pg_temp.fails(format('select public.bank_delete_item(%L)', (select id from t_ids where name='q1')), 'มีสถิติแล้ว', 'ข้อที่มีสถิติลบไม่ได้');
insert into t_ids select 'q4', public.bank_save_item(pg_temp.item(null, 'ข้อที่จะลบ', array['1','2','3','4'], 1, true), 'new');
insert into t_ids select 'q5', public.bank_save_item(pg_temp.item(null, 'ข้อที่ใช้ในชุดแล้ว', array['1','2','3','4'], 1, true), 'new');
insert into exams(title, subject_id, grade_id, item_count) values ('ชุดทดสอบเฟส 2', 'MATH', 'P4', 1);
insert into exam_items(exam_id, item_id, item_version, base_position, indicator_id, difficulty_at_build)
select (select id from exams where title = 'ชุดทดสอบเฟส 2'), id, 1, 1, 'MATH-2560-P4-01', 1 from t_ids where name = 'q5';
select pg_temp.fails(format('select public.bank_delete_item(%L)', (select id from t_ids where name='q5')), 'เคยถูกใช้ในชุดข้อสอบ', 'ข้อที่ใช้ในชุดแล้วลบไม่ได้');
select pg_temp.ok(public.bank_delete_item((select id from t_ids where name='q4')), 'ลบข้อร่างที่ยังไม่ใช้ได้');
select pg_temp.ok(not exists (select 1 from items where id = (select id from t_ids where name='q4')), 'ข้อที่ลบหายจากคลัง');
reset role;

-- ===== 2) สิทธิ์ =====
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.fails(format('select public.bank_save_item(%L::jsonb, ''new'')', pg_temp.item(null, 'ครูแอบเพิ่ม', array['1','2','3','4'], 1, true)), 'ไม่มีสิทธิ์', 'teacher เพิ่มข้อในคลังไม่ได้');
select pg_temp.fails(format('select public.bank_set_status(%L, ''retired'')', (select id from t_ids where name='q1')), 'ไม่มีสิทธิ์', 'teacher เปลี่ยนสถานะข้อไม่ได้');
select pg_temp.fails('select public.bank_export()', 'ไม่มีสิทธิ์', 'teacher สำรองคลังไม่ได้');
select pg_temp.fails('select public.bank_import(''{"format":"itembank.bank.v1","items":[]}''::jsonb, false)', 'ไม่มีสิทธิ์', 'teacher นำเข้าคลังไม่ได้');
select pg_temp.ok((select count(*) from bank_item_list) = 0, 'teacher มองไม่เห็นรายการข้อในคลัง');
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.fails('select public.bank_export()', 'permission denied', 'anon เรียกฟังก์ชันคลังไม่ได้');
select pg_temp.ok((select count(*) from bank_item_list) = 0, 'anon มองไม่เห็นรายการข้อ');
reset role;

-- ===== 3) สำรองและนำเข้า JSON =====
\i supabase/seed/S900_dev_sample_items.sql
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
create temp table t_backup as select public.bank_export() as doc;
select pg_temp.ok((select doc->>'format' from t_backup) = 'itembank.bank.v1', 'ไฟล์สำรองระบุรูปแบบ itembank.bank.v1');
select pg_temp.ok((select (doc->>'item_count')::int from t_backup) = 4, 'สำรองไม่รวมข้อหุ่นเป็นค่าเริ่มต้น (4 ข้อจริง)');
select pg_temp.ok((select (public.bank_export('MATH', true)->>'item_count')::int) = 268, 'เลือกรวมข้อหุ่นได้ (4 + 264)');
select pg_temp.ok((select jsonb_array_length(i->'versions') from t_backup, jsonb_array_elements(doc->'items') i where i->>'status' = 'draft' and i->>'subtopic' = 'เศษส่วน' and (i->>'current_version')::int = 2) = 2,
                  'ไฟล์สำรองมีทุกเวอร์ชัน');
select pg_temp.ok((select count(*) from t_backup, jsonb_array_elements(doc->'items') i, jsonb_array_elements(i->'stat_rounds') s) = 1, 'ไฟล์สำรองมีสถิติรายรอบ');
select pg_temp.ok((select bool_and(i->>'cognitive_level' = 'apply' and i ? 'indicator_code') from t_backup, jsonb_array_elements(doc->'items') i), 'ไฟล์สำรองใช้รหัสระดับแบบอ่านได้');

create temp table t_before as
select item_code, status, current_version, current_difficulty, est_difficulty, subtopic,
       (select count(*) from item_events e where e.item_id = i.id) as events,
       (select n from item_stats s where s.item_id = i.id) as n
from items i where not is_sample;

-- ลองนำเข้าทับ: ทุกข้อซ้ำ → ข้าม
select pg_temp.ok((select (r->>'inserted')::int = 0 and jsonb_array_length(r->'skipped') = 4 from (select public.bank_import(doc, false) r from t_backup) x), 'นำเข้าซ้ำ: ข้ามข้อที่มีรหัสอยู่แล้ว');

-- จำลองคลังหาย แล้วกู้คืน
reset role;
delete from exam_items; delete from items where not is_sample;
set role authenticated;
select pg_temp.ok((select (r->>'inserted')::int = 4 and r->>'dry_run' = 'true' from (select public.bank_import(doc, true) r from t_backup) x), 'ทดลองนำเข้า: รายงานว่าจะเพิ่ม 4 ข้อ');
select pg_temp.ok((select count(*) from items where not is_sample) = 0, 'ทดลองนำเข้า: ไม่บันทึกอะไรจริง');
select pg_temp.ok((select (r->>'inserted')::int = 4 and jsonb_array_length(r->'errors') = 0 from (select public.bank_import(doc, false) r from t_backup) x), 'กู้คืนจากไฟล์สำรอง 4 ข้อ');
select pg_temp.ok((select count(*) from t_before b join items i using (item_code)
                   where i.status = b.status and i.current_version = b.current_version and i.current_difficulty = b.current_difficulty
                     and i.est_difficulty = b.est_difficulty and i.subtopic is not distinct from b.subtopic) = 4,
                  'กู้คืนแล้วรหัส สถานะ เวอร์ชัน ความยาก ตรงเดิม');
select pg_temp.ok((select count(*) from t_before b join items i using (item_code)
                   where (select n from item_stats s where s.item_id = i.id) = b.n) = 4, 'กู้คืนแล้วสถิติตรงเดิม');
select pg_temp.ok((select count(*) from t_before b join items i using (item_code)
                   where (select count(*) from item_events e where e.item_id = i.id and e.event_type <> 'imported') = b.events) = 4,
                  'กู้คืนแล้วประวัติครบ');
select pg_temp.ok((select count(*) from item_versions v join items i on i.id = v.item_id where not i.is_sample) = 5, 'กู้คืนแล้วเวอร์ชันครบ (2+1+1+1)');

-- ข้อใหม่จากไฟล์ (ไม่มีรหัส) + ข้อเสีย 1 ข้อ ต้องไม่ทำให้ข้ออื่นล้ม
select pg_temp.ok((select (r->>'inserted')::int = 2 and jsonb_array_length(r->'errors') = 1
                     and (r->'errors'->0->>'index')::int = 2 and r->'errors'->0->>'message' like '%ไม่พบตัวชี้วัด%'
                   from (select public.bank_import(jsonb_build_object('format', 'itembank.bank.v1', 'items', jsonb_build_array(
                     jsonb_build_object('indicator_code', 'ค 1.1 ป.4/2', 'cognitive_level', 'understand', 'est_difficulty', 'easy', 'status', 'active',
                       'content', jsonb_build_object('stem', 'ข้อใหม่จาก AI', 'options', jsonb_build_array('1','2','3','4'), 'figure', null),
                       'answer', jsonb_build_object('choice', 2)),
                     jsonb_build_object('indicator_code', 'ไม่มีจริง', 'cognitive_level', 1, 'est_difficulty', 1,
                       'content', jsonb_build_object('stem', 'x', 'options', jsonb_build_array('1','2','3','4')), 'answer', jsonb_build_object('choice', 1)),
                     jsonb_build_object('indicator_id', 'MATH-2560-P6-01', 'cognitive_level', 'วิเคราะห์', 'est_difficulty', 'ท้าทาย',
                       'content', jsonb_build_object('stem', 'ข้อใหม่ 2', 'options', jsonb_build_array('ก','ข','ค','ง')), 'answer', jsonb_build_object('choice', 4))
                   )), false) r) x), 'นำเข้าข้อใหม่ 2 ข้อ และรายงานข้อเสียโดยไม่ล้มทั้งชุด');
select pg_temp.ok((select count(*) from items i join item_versions v on v.item_id = i.id
                   where v.content->>'stem' like 'ข้อใหม่%' and i.status = 'draft' and i.current_version = 1) = 2, 'ข้อใหม่จากไฟล์เป็นร่างเสมอ (แม้ไฟล์บอกสถานะอื่น)');
select pg_temp.ok((select max(item_code) from items where not is_sample) > (select max(item_code) from t_before), 'ข้อใหม่ได้รหัสต่อจากรหัสที่กู้คืน ไม่ชนกัน');
select pg_temp.fails('select public.bank_import(''{"format":"other","items":[]}''::jsonb, false)', 'รูปแบบไฟล์ไม่ถูกต้อง', 'ไฟล์ผิดรูปแบบถูกปฏิเสธ');
reset role;

-- ข้อหุ่นได้รับการยกเว้นการตรวจคุณภาพ (ใช้ทดสอบระบบ)
update items set current_version = current_version where is_sample;
select pg_temp.ok((select count(*) from items where is_sample and status = 'reviewed') = 264, 'ข้อหุ่นยังเป็นตรวจแล้วได้');
select public.bank_remove_sample_items();
delete from exams where title = 'ชุดทดสอบเฟส 2';

\echo ALL PHASE 2 DB TESTS PASSED
