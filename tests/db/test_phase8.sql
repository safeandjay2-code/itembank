-- ทดสอบ One Stop เฟส 1 (migration 0011): สมุดคะแนน
--   ก) สร้างห้อง/ช่องคะแนน + ตรวจค่าตั้งค่า  ข) ผลตรวจ → คะแนนจริงรายตัวชี้วัด (ตรงกับคะแนนในกระดาษ)
--   ค) คิดคะแนน: บวกตรง/เฉลี่ย · สอบซ่อม 4 แบบ · ขาดสอบ 2 แบบ · ปัดเศษ 2 แบบ · ปลายภาค (คำนวณมือทุกค่า)
--   ง) คะแนนที่ปรับ แยกจากคะแนนจริง  จ) ปิดชุดแล้วคะแนนยังอยู่ · ไม่หมดอายุ  ฉ) กันแก้ผิด + สิทธิ์
--   ช) ปิดเทอม = ลบข้อมูลรายเลขที่ทั้งหมด เหลือค่ารวม  ซ) ลบห้อง/ลบชุด
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
-- ค่าในสมุดคะแนน: เลขที่ × ช่อง (ระบุช่องด้วยรหัสตัวชี้วัด, 'final' หรือชื่อช่องอื่น)
create or replace function pg_temp.cell(p_seat int, p_target text, p_field text default 'value') returns jsonb language sql as $$
  select c -> p_field
  from (select public.gb_sheet(current_setting('t.k')::uuid) s) x,
       jsonb_array_elements(x.s->'columns') col, jsonb_array_elements(x.s->'rows') r, jsonb_array_elements(r->'cells') c
  where (r->>'seat_no')::int = p_seat and c->>'column_id' = col->>'id'
    and (col->>'indicator_id' = p_target or col->>'kind' = p_target or col->>'label' = p_target)
$$;
create or replace function pg_temp.vals(p_target text, p_field text default 'value') returns text language sql as $$
  select string_agg(coalesce(pg_temp.cell(k, p_target, p_field) #>> '{}', '-'), ' ' order by k) from generate_series(1, 5) k
$$;
-- กระดาษคำตอบ: n ข้อ ข้อที่ระบุตอบถูก (เฉลยทุกข้อ = 1) ที่เหลือตอบ 2
create or replace function pg_temp.ans(n int, ok int[]) returns jsonb language sql as $$
  select jsonb_agg(case when k = any(ok) then 1 else 2 end order by k) from generate_series(1, n) k
$$;

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@test'),
  ('00000000-0000-0000-0000-00000000000b', 'teacher@test'),
  ('00000000-0000-0000-0000-00000000000c', 'other@test')
on conflict (id) do nothing;
update profiles set role = 'owner' where id = '00000000-0000-0000-0000-00000000000a';
delete from exams; delete from item_stat_rounds; delete from items; delete from calibration_runs; delete from gb_classrooms;

-- ข้อสอบ: a1–a3 = ตัวชี้วัด P5-01 · b1–b3 = P5-02 · c1 = P5-03 (เฉลย = ตัวเลือก 1 ทุกข้อ)
create temp table it(code text, id uuid, ind text);
insert into it values
  ('a1', '00000000-0000-4000-8800-0000000000a1', 'MATH-2560-P5-01'), ('a2', '00000000-0000-4000-8800-0000000000a2', 'MATH-2560-P5-01'),
  ('a3', '00000000-0000-4000-8800-0000000000a3', 'MATH-2560-P5-01'), ('b1', '00000000-0000-4000-8800-0000000000b1', 'MATH-2560-P5-02'),
  ('b2', '00000000-0000-4000-8800-0000000000b2', 'MATH-2560-P5-02'), ('b3', '00000000-0000-4000-8800-0000000000b3', 'MATH-2560-P5-02'),
  ('c1', '00000000-0000-4000-8800-0000000000c1', 'MATH-2560-P5-03');
insert into items(id, item_code, owner_id, subject_id, indicator_id, cognitive_level, est_difficulty, current_difficulty, status)
select id, 'T8-' || code, '00000000-0000-0000-0000-00000000000a', 'MATH', ind, 1, 2, 2, 'active' from it;
insert into item_versions(item_id, version, content, answer, qa)
select id, 1, jsonb_build_object('stem', 'โจทย์', 'options', jsonb_build_array('ก','ข','ค','ง'), 'figure', null,
       'explanation', '', 'distractor_rationale', jsonb_build_array(null, null, null, null)),
       '{"choice":1}'::jsonb, '{"passed":true,"errors":[],"warnings":[]}'::jsonb from it;

-- สร้างชุดข้อสอบของครู B (1 ชุด ไม่สลับ) ตรงเข้าตาราง
create or replace function pg_temp.mk_exam(p_id uuid, p_title text, p_codes text[], p_seats int, p_minutes int) returns void language plpgsql as $$
begin
  insert into exams(id, owner_id, title, subject_id, grade_id, item_count, set_count, student_count, status, created_at)
  values (p_id, '00000000-0000-0000-0000-00000000000b', p_title, 'MATH', 'P5', array_length(p_codes, 1), 1, p_seats, 'draft',
          now() - interval '1 day' + make_interval(mins => p_minutes));
  insert into exam_items(exam_id, item_id, item_version, base_position, indicator_id, difficulty_at_build)
  select p_id, it.id, 1, c.ord, it.ind, 2 from unnest(p_codes) with ordinality c(code, ord) join it on it.code = c.code;
  insert into exam_set_items(exam_id, set_no, position, item_id, option_order)
  select p_id, 1, c.ord, it.id, '{1,2,3,4}' from unnest(p_codes) with ordinality c(code, ord) join it on it.code = c.code;
  insert into exam_seats(exam_id, seat_no, set_no) select p_id, k, 1 from generate_series(1, p_seats) k;
end $$;
\set E1 '00000000-0000-4000-e800-000000000001'
\set E2 '00000000-0000-4000-e800-000000000002'
\set R1 '00000000-0000-4000-e800-000000000003'
\set F1 '00000000-0000-4000-e800-000000000004'
\set E3 '00000000-0000-4000-e800-000000000005'
\set P1 '00000000-0000-4000-e800-000000000006'
\set D1 '00000000-0000-4000-e800-000000000007'
\set R2 '00000000-0000-4000-e800-000000000008'
\set X1 '00000000-0000-4000-e800-000000000009'
select pg_temp.mk_exam(:'E1', 'เก็บคะแนน 1', '{a1,a2,a3,b1,b2,b3}', 5, 1);
select pg_temp.mk_exam(:'E2', 'เก็บคะแนน 2', '{a1,a2}', 5, 2);
select pg_temp.mk_exam(:'R1', 'สอบซ่อม 1', '{a1,a2,a3,b1,b2,b3}', 5, 3);
select pg_temp.mk_exam(:'F1', 'ปลายภาค', '{a1,a2,a3,b1,b2,b3}', 5, 4);
select pg_temp.mk_exam(:'E3', 'เก็บคะแนน 3', '{c1}', 5, 5);
select pg_temp.mk_exam(:'P1', 'ฝึก', '{a1,a2}', 5, 6);
select pg_temp.mk_exam(:'D1', 'ยังไม่สอบ', '{a1}', 5, 7);
select pg_temp.mk_exam(:'R2', 'สอบซ่อมซ้อน', '{a1}', 5, 8);
grant select on it to authenticated;

set client_min_messages = notice;
select pg_temp.ok(exists (select 1 from app_migrations where version = '0011'), 'บันทึก migration 0011');
select pg_temp.ok((select count(*) from app_settings where key like 'gradebook.%') = 8, 'ค่าเริ่มต้นสมุดคะแนน 8 ค่า');
select pg_temp.ok((select count(*) from exams where purpose = 'practice' and classroom_id is null) = 8, 'ชุดข้อสอบเดิมทั้งหมด = ชุดฝึก ไม่ผูกห้อง');

-- ===== ก) สร้างห้อง + ช่องคะแนน =====
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select set_config('t.k', public.gb_classroom_create('{"name":"ป.5/1","grade_id":"P5","academic_year":2569,"term":2,"student_count":5}')::text, false);
select pg_temp.ok((select count(*) from gb_columns where classroom_id = current_setting('t.k')::uuid and kind = 'final' and max_score = 30) = 1,
                  'สร้างห้องแล้วได้ช่องปลายภาค คะแนนเต็มเริ่มต้น 30');
select pg_temp.fails($$select public.gb_classroom_create('{"name":" ป.5/1 ","grade_id":"P5","academic_year":2569,"term":2,"student_count":5}')$$,
                     'มีห้อง', 'ห้องชื่อซ้ำในเทอมเดียวกัน → ปฏิเสธ');
select pg_temp.fails($$select public.gb_classroom_create('{"name":"ป.5/2","grade_id":"P5","academic_year":2569,"term":2,"student_count":5,"settings":{"rounding":"2dp"}}')$$,
                     'การปัด', 'ตั้งค่าการปัดผิด → ปฏิเสธ');
select pg_temp.fails($$select public.gb_classroom_create('{"name":"ป.5/2","grade_id":"P5","academic_year":2569,"term":2,"student_count":5,"settings":{"color":"red"}}')$$,
                     'ไม่รู้จักการตั้งค่า', 'คีย์ตั้งค่าที่ไม่รู้จัก → ปฏิเสธ');
select pg_temp.fails($$select public.gb_classroom_create('{"name":"ป.5/2","grade_id":"P5","academic_year":2569,"term":2,"student_count":61}')$$,
                     'ไม่เกิน 60', 'นักเรียนเกิน 60 คน → ปฏิเสธ');
select public.gb_column_add(current_setting('t.k')::uuid, 'indicator', 'MATH-2560-P5-01', null, 10);
select public.gb_column_add(current_setting('t.k')::uuid, 'indicator', 'MATH-2560-P5-02', null, null);
select public.gb_column_add(current_setting('t.k')::uuid, 'other', null, 'งานกลุ่ม', 5);
select pg_temp.fails($$select public.gb_column_add(current_setting('t.k')::uuid, 'indicator', 'MATH-2560-P5-01', null, 10)$$,
                     'มีในห้องแล้ว', 'ตัวชี้วัดซ้ำในห้อง → ปฏิเสธ');
select pg_temp.fails($$select public.gb_column_add(current_setting('t.k')::uuid, 'final', null, null, 20)$$,
                     'ช่องปลายภาคมีอยู่แล้ว', 'เพิ่มช่องปลายภาคที่ 2 → ปฏิเสธ');
select pg_temp.fails($$select public.gb_column_add(current_setting('t.k')::uuid, 'other', null, '  ', 5)$$,
                     'check', 'ช่องอื่นไม่มีชื่อ → ปฏิเสธ');
select pg_temp.ok((select (s->'totals'->>'collect_max')::numeric = 15 and (s->'totals'->>'final_max')::numeric = 30
                          and (s->'totals'->>'unset_columns')::int = 1 and (s->>'seat_count')::int = 5
                          and s->'columns'->0->>'standard_code' = 'ค 1.1' and s->'columns'->0->>'indicator_code' = 'ป.5/8'
                          and s->'columns'->-1->>'kind' = 'final' and s->'columns'->0->>'collected' = 'false'
                   from (select public.gb_sheet(current_setting('t.k')::uuid) s) x),
                  'ไม่บังคับรวม 100 (เก็บ 15 + สอบ 30) · ช่องที่ยังไม่ตั้งคะแนน 1 · หัวชีท ค 1.1 / ป.5/8 · ปลายภาคอยู่ท้าย · ยังไม่เก็บคะแนน');
select public.gb_column_update(id, 20) from gb_columns where classroom_id = current_setting('t.k')::uuid and indicator_id = 'MATH-2560-P5-02';

-- ผูกชุดข้อสอบ
select public.gb_exam_link(:'E1', current_setting('t.k')::uuid, 'collect');
select public.gb_exam_link(:'E2', current_setting('t.k')::uuid, 'collect');
select public.gb_exam_link(:'R1', current_setting('t.k')::uuid, 'collect', :'E1');
select public.gb_exam_link(:'F1', current_setting('t.k')::uuid, 'final');
select public.gb_exam_link(:'E3', current_setting('t.k')::uuid, 'collect');
select public.gb_exam_link(:'D1', current_setting('t.k')::uuid, 'collect');
select public.gb_exam_link(:'R2', current_setting('t.k')::uuid, 'collect', :'R1');
select pg_temp.ok((select retake_of from exams where id = :'R2') = :'E1', 'สอบซ่อมของสอบซ่อม → ชี้ไปชุดแรกของกลุ่ม');
select pg_temp.fails($$select public.gb_exam_link('00000000-0000-4000-e800-000000000006', current_setting('t.k')::uuid, 'final', '00000000-0000-4000-e800-000000000001')$$,
                     'ประเภทการสอบเดียวกับ', 'สอบซ่อมต่างประเภทกับชุดเดิม → ปฏิเสธ');
select pg_temp.fails($$select public.gb_exam_link('00000000-0000-4000-e800-000000000006', null, 'collect')$$,
                     'ต้องเลือกห้อง', 'ชุดเก็บคะแนนไม่เลือกห้อง → ปฏิเสธ');
select public.gb_exam_link(:'R2', null, 'practice');

-- ===== ข) ผลตรวจ → คะแนนจริง =====
--   E1 (a1 a2 a3 b1 b2 b3): เลขที่ 1 ถูกหมด · 2 ถูกข้อ 1,2,4 · 3 ถูกข้อ 4,5,6 · 4 ขาดสอบ · 5 ถูกข้อ 1
select public.scan_save_response(:'E1', 1, 1, pg_temp.ans(6, '{1,2,3,4,5,6}'));
select public.scan_save_response(:'E1', 2, 1, pg_temp.ans(6, '{1,2,4}'));
select public.scan_save_response(:'E1', 3, 1, pg_temp.ans(6, '{4,5,6}'));
select public.scan_save_response(:'E1', 5, 1, pg_temp.ans(6, '{1}'), '{}', 'upload');
--   E2 (a1 a2): 1 ถูก 2 · 2 ถูก 2 · 3 ถูก 0 · 4 ถูก 2 · 5 ขาดสอบ
select public.scan_save_response(:'E2', 1, 1, pg_temp.ans(2, '{1,2}'));
select public.scan_save_response(:'E2', 2, 1, pg_temp.ans(2, '{1,2}'));
select public.scan_save_response(:'E2', 3, 1, '[null,"multi"]');
select public.scan_save_response(:'E2', 4, 1, pg_temp.ans(2, '{1,2}'));
--   R1 สอบซ่อม E1: 3 ถูกข้อ 1,2,3 · 5 ถูกข้อ 1,2
select public.scan_save_response(:'R1', 3, 1, pg_temp.ans(6, '{1,2,3}'));
select public.scan_save_response(:'R1', 5, 1, pg_temp.ans(6, '{1,2}'));
--   F1 ปลายภาค: 1 ถูกหมด · 2 ถูก 3 ข้อ
select public.scan_save_response(:'F1', 1, 1, pg_temp.ans(6, '{1,2,3,4,5,6}'));
select public.scan_save_response(:'F1', 2, 1, pg_temp.ans(6, '{1,2,3}'));
--   P1 ฝึก (ไม่ผูกห้อง)
select public.scan_save_response(:'P1', 1, 1, pg_temp.ans(2, '{1}'));

select pg_temp.ok((select string_agg(seat_no || ':' || indicator_id || '=' || correct || '/' || total, ' ' order by seat_no, indicator_id)
                   from gb_attempts where exam_id = :'E1') =
                  '1:MATH-2560-P5-01=3/3 1:MATH-2560-P5-02=3/3 2:MATH-2560-P5-01=2/3 2:MATH-2560-P5-02=1/3 3:MATH-2560-P5-01=0/3 3:MATH-2560-P5-02=3/3 5:MATH-2560-P5-01=1/3 5:MATH-2560-P5-02=0/3',
                  'ผลตรวจ E1 → คะแนนจริงรายเลขที่ × ตัวชี้วัด ถูกต้อง');
select pg_temp.ok((select bool_and(r.score = (select sum(a.correct) from gb_attempts a where a.exam_id = r.exam_id and a.seat_no = r.seat_no))
                   from responses r join exams e on e.id = r.exam_id where e.classroom_id is not null),
                  'ผลรวมคะแนนรายตัวชี้วัด = คะแนนในกระดาษ ทุกแผ่นทุกชุด');
select pg_temp.ok((select correct from gb_attempts where exam_id = :'E2' and seat_no = 3) = 0, 'ไม่ฝน/ฝนหลายช่อง = ผิด');
select pg_temp.ok(not exists (select 1 from gb_attempts where exam_id = :'P1'), 'ชุดฝึกไม่เข้าสมุดคะแนน');
select public.scan_save_response(:'E1', 2, 1, pg_temp.ans(6, '{1,2,3,4}'), '{}', 'camera', true);
select pg_temp.ok((select correct from gb_attempts where exam_id = :'E1' and seat_no = 2 and indicator_id = 'MATH-2560-P5-01') = 3,
                  'ตรวจแผ่นเดิมซ้ำ (เขียนทับ) → คะแนนจริงอัปเดตตาม');
select public.scan_save_response(:'E1', 2, 1, pg_temp.ans(6, '{1,2,4}'), '{}', 'camera', true);

-- ===== ค) คิดคะแนน (คำนวณมือ) =====
-- ค่าเริ่มต้น: บวกตรง · สอบซ่อมนับครั้งสูงสุด · ขาดสอบ = 0 · ปัดจำนวนเต็ม
--   P5-01 (เต็ม 10) กลุ่ม E1(3 ข้อ, ซ่อม R1) + E2(2 ข้อ):
--     1: (3+2)/5=1 →10 · 2: (2+2)/5=.8 →8 · 3: (max(0,1)·3+0)/5=.6 →6 · 4: (0+2)/5=.4 →4 · 5: (max(1/3,2/3)·3+0)/5=.4 →4
--   P5-02 (เต็ม 20) กลุ่ม E1: 1: 20 · 2: 1/3 → 6.67 →7 · 3: max(1,0) → 20 · 4: 0 · 5: max(0,0) → 0
--   ปลายภาค (เต็ม 30) F1 6 ข้อ: 1: 30 · 2: 15 · 3–5: 0
select pg_temp.ok(pg_temp.vals('MATH-2560-P5-01') = '10 8 6 4 4', 'บวกตรง+สอบซ่อมสูงสุด: P5-01 = 10 8 6 4 4');
select pg_temp.ok(pg_temp.vals('MATH-2560-P5-02') = '20 7 20 0 0', 'P5-02 = 20 7 20 0 0 (6.67 ปัดเป็น 7)');
select pg_temp.ok(pg_temp.vals('final') = '30 15 0 0 0', 'ปลายภาครวมช่องเดียว = 30 15 0 0 0');
select pg_temp.ok(pg_temp.vals('งานกลุ่ม') = '- - - - -', 'ช่องอื่นยังไม่กรอก = ว่าง');
select pg_temp.ok(pg_temp.vals('MATH-2560-P5-01', 'real') = '10.00 8.00 6.00 4.00 4.00' and pg_temp.vals('MATH-2560-P5-02', 'real') = '20.00 6.67 20.00 0.00 0.00',
                  'คะแนนจริงก่อนปัด เก็บ 2 ตำแหน่ง');
select pg_temp.ok(pg_temp.vals('MATH-2560-P5-01', 'raw_correct') = '5.00 4.00 3.00 2.00 2.00' and pg_temp.vals('MATH-2560-P5-01', 'raw_total') = '5 5 5 5 5',
                  'คะแนนดิบสะสม/เต็มสะสม (เช่น 4/5)');
select pg_temp.ok(pg_temp.cell(4, 'MATH-2560-P5-01', 'missing') = jsonb_build_array(:'E1'::uuid)
                  and pg_temp.cell(5, 'MATH-2560-P5-01', 'missing') = jsonb_build_array(:'E2'::uuid)
                  and pg_temp.cell(3, 'MATH-2560-P5-01', 'missing') = '[]', 'เตือนขาดสอบ: เลขที่ 4 ขาด E1 · เลขที่ 5 ขาด E2');
select pg_temp.ok((select (r->>'total_collect')::numeric = 30 and (r->>'total_final')::numeric = 30 and (r->>'total')::numeric = 60
                   from (select public.gb_sheet(current_setting('t.k')::uuid) s) x, jsonb_array_elements(x.s->'rows') r where r->>'seat_no' = '1'),
                  'รวมเก็บ 30 + สอบ 30 = 60 (รวมจากคะแนนที่ปัดแล้ว เหมือนสูตร SUM)');
select pg_temp.ok((select s->'unplanned_indicators' = '[]' and jsonb_array_length(s->'columns'->0->'groups') = 2 and s->'columns'->0->>'collected' = 'true'
                   from (select public.gb_sheet(current_setting('t.k')::uuid) s) x), 'P5-01 มี 2 กลุ่มการสอบ · ชุดที่ยังไม่สอบ (D1, E3) ไม่นับ');

-- สอบซ่อม: ล่าสุด / เฉลี่ย / ครูเลือก
select public.gb_classroom_update(current_setting('t.k')::uuid, '{"settings":{"retake_policy":"latest"}}');
select pg_temp.ok(pg_temp.vals('MATH-2560-P5-01') = '10 8 6 4 4' and pg_temp.vals('MATH-2560-P5-02') = '20 7 0 0 0',
                  'สอบซ่อมนับครั้งล่าสุด: เลขที่ 3 P5-02 = 0 (R1 ผิดหมด)');
select public.gb_classroom_update(current_setting('t.k')::uuid, '{"settings":{"retake_policy":"mean"}}');
--   เลขที่ 3 P5-01: (0+1)/2 ·3 /5 = .3 → 3 · P5-02: (1+0)/2 → 10 · เลขที่ 5 P5-01: (1/3+2/3)/2·3/5 = .3 → 3
select pg_temp.ok(pg_temp.vals('MATH-2560-P5-01') = '10 8 3 4 3' and pg_temp.vals('MATH-2560-P5-02') = '20 7 10 0 0',
                  'สอบซ่อมเฉลี่ย: เลขที่ 3 = 3, 10 · เลขที่ 5 = 3');
select public.gb_classroom_update(current_setting('t.k')::uuid, '{"settings":{"retake_policy":"manual"}}');
select public.gb_retake_choose(:'E1', 3, :'E1');
select pg_temp.ok(pg_temp.vals('MATH-2560-P5-01') = '10 8 0 4 4' and pg_temp.vals('MATH-2560-P5-02') = '20 7 20 0 0',
                  'ครูเลือกครั้งที่นับ: เลขที่ 3 นับ E1 (P5-01 = 0, P5-02 = 20) · คนที่ไม่ได้เลือก = สูงสุด');
select pg_temp.fails($$select public.gb_retake_choose('00000000-0000-4000-e800-000000000001', 3, '00000000-0000-4000-e800-000000000002')$$,
                     'ไม่ใช่สอบซ่อม', 'เลือกชุดที่ไม่ใช่สอบซ่อมของกลุ่ม → ปฏิเสธ');
select pg_temp.fails($$select public.gb_retake_choose('00000000-0000-4000-e800-000000000001', 4, '00000000-0000-4000-e800-000000000003')$$,
                     'ไม่มีผลสอบ', 'เลือกครั้งที่เลขที่นั้นไม่ได้สอบ → ปฏิเสธ');
select public.gb_retake_choose(:'E1', 3, null);
select public.gb_classroom_update(current_setting('t.k')::uuid, '{"settings":{"retake_policy":null}}');
select pg_temp.ok(pg_temp.vals('MATH-2560-P5-01') = '10 8 6 4 4' and (select settings from gb_classrooms where id = current_setting('t.k')::uuid) = '{}',
                  'ตั้งค่าเป็น null = กลับไปใช้ค่าเริ่มต้น (สูงสุด)');

-- รวมแบบเฉลี่ยแต่ละครั้ง / ขาดสอบไม่นับ / ทศนิยม 1 ตำแหน่ง
select public.gb_classroom_update(current_setting('t.k')::uuid, '{"settings":{"aggregation":"mean"}}');
--   1: (1+1)/2 →10 · 2: (2/3+1)/2 = 8.33 →8 · 3: (1+0)/2 →5 · 4: (0+1)/2 →5 · 5: (2/3+0)/2 = 3.33 →3
select pg_temp.ok(pg_temp.vals('MATH-2560-P5-01') = '10 8 5 5 3', 'เฉลี่ยแต่ละครั้งเท่ากัน: 10 8 5 5 3');
select public.gb_classroom_update(current_setting('t.k')::uuid, '{"settings":{"aggregation":"sum","absent_policy":"skip"}}');
--   4: 2/2 → 10 · 5: 2/3 → 6.67 → 7 · ปลายภาค 3–5 ไม่มีผล → ว่าง
select pg_temp.ok(pg_temp.vals('MATH-2560-P5-01') = '10 8 6 10 7' and pg_temp.vals('final') = '30 15 - - -',
                  'ขาดสอบไม่นับ: เลขที่ 4 = 10, เลขที่ 5 = 7 · ปลายภาคคนขาด = ว่าง');
select public.gb_classroom_update(current_setting('t.k')::uuid, '{"settings":{"absent_policy":null,"rounding":"1dp"}}');
select pg_temp.ok(pg_temp.vals('MATH-2560-P5-02') = '20.0 6.7 20.0 0.0 0.0', 'ทศนิยม 1 ตำแหน่ง: 6.67 → 6.7');
select public.gb_classroom_update(current_setting('t.k')::uuid, '{"settings":{"rounding":null}}');
select public.gb_column_update(id, 7) from gb_columns where classroom_id = current_setting('t.k')::uuid and indicator_id = 'MATH-2560-P5-01';
--   ปัดครึ่งขึ้น: เลขที่ 2 = .8·7 = 5.6 → 6 · เลขที่ 4,5 = .4·7 = 2.8 → 3 ; ตั้ง 12.5: เลขที่ 4 = .4·12.5 = 5.0
select pg_temp.ok(pg_temp.vals('MATH-2560-P5-01') = '7 6 4 3 3', 'แก้คะแนนเต็มแล้วคำนวณใหม่ทันที (เต็ม 7: 5.6 → 6, 4.2 → 4)');
select public.gb_column_update(id, 12.5) from gb_columns where classroom_id = current_setting('t.k')::uuid and indicator_id = 'MATH-2560-P5-01';
select pg_temp.ok(pg_temp.vals('MATH-2560-P5-01') = '13 10 8 5 5', 'ปัดครึ่งขึ้น: 12.5 → 13, 7.5 → 8');
select public.gb_column_update(id, null, null, true) from gb_columns where classroom_id = current_setting('t.k')::uuid and indicator_id = 'MATH-2560-P5-01';
select pg_temp.ok(pg_temp.vals('MATH-2560-P5-01') = '- - - - -' and pg_temp.vals('MATH-2560-P5-01', 'raw_correct') = '5.00 4.00 3.00 2.00 2.00',
                  'ยังไม่ตั้งคะแนนเต็ม: ไม่แปลงคะแนน แต่ยังเห็นคะแนนดิบสะสม');
select public.gb_column_update(id, 10) from gb_columns where classroom_id = current_setting('t.k')::uuid and indicator_id = 'MATH-2560-P5-01';

-- ตัวชี้วัดที่ยังไม่มีช่อง
select public.scan_save_response(:'E3', 1, 1, pg_temp.ans(1, '{1}'));
select pg_temp.ok((select s->'unplanned_indicators' from (select public.gb_sheet(current_setting('t.k')::uuid) s) x) = '["MATH-2560-P5-03"]',
                  'สอบตัวชี้วัดที่ยังไม่มีช่อง → แจ้งให้เพิ่ม');
select public.gb_column_add(current_setting('t.k')::uuid, 'indicator', 'MATH-2560-P5-03', null, 5);
select pg_temp.ok(pg_temp.vals('MATH-2560-P5-03') = '5 0 0 0 0', 'เพิ่มช่องทีหลัง คะแนนที่สอบไปแล้วเข้ามาเอง');

-- เรียงช่อง
select public.gb_column_reorder(current_setting('t.k')::uuid,
  (select array_agg(id order by case indicator_id when 'MATH-2560-P5-03' then 1 when 'MATH-2560-P5-02' then 2 when 'MATH-2560-P5-01' then 3 else 4 end)
   from gb_columns where classroom_id = current_setting('t.k')::uuid and kind <> 'final'));
select pg_temp.ok((select string_agg(coalesce(c->>'indicator_id', c->>'kind'), ',' order by o)
                   from (select public.gb_sheet(current_setting('t.k')::uuid) s) x, jsonb_array_elements(x.s->'columns') with ordinality t(c, o))
                  = 'MATH-2560-P5-03,MATH-2560-P5-02,MATH-2560-P5-01,other,final', 'เรียงช่องตามแผนการสอน (ปลายภาคอยู่ท้ายเสมอ)');
select pg_temp.fails($$select public.gb_column_reorder(current_setting('t.k')::uuid, (select array_agg(id) from gb_columns where classroom_id = current_setting('t.k')::uuid and kind = 'indicator'))$$,
                     'ไม่ครบ', 'ส่งลำดับไม่ครบทุกช่อง → ปฏิเสธ');

-- ===== ง) คะแนนที่ปรับ =====
select public.gb_override_set(id, 4, 5, 'pass') from gb_columns where classroom_id = current_setting('t.k')::uuid and indicator_id = 'MATH-2560-P5-01';
select public.gb_override_set(id, 2, 4, 'manual') from gb_columns where classroom_id = current_setting('t.k')::uuid and label = 'งานกลุ่ม';
select pg_temp.ok(pg_temp.cell(4, 'MATH-2560-P5-01') = '5' and pg_temp.cell(4, 'MATH-2560-P5-01', 'real') = '4.00'
                  and pg_temp.cell(4, 'MATH-2560-P5-01', 'reason') = '"pass"', 'ปรับให้ผ่าน: ชีทใช้ 5 · คะแนนจริงยังเป็น 4');
select pg_temp.ok(pg_temp.vals('งานกลุ่ม') = '- 4 - - -', 'ช่องอื่นกรอกด้วยมือได้');
select pg_temp.fails($$select public.gb_override_set(id, 4, 11) from gb_columns where classroom_id = current_setting('t.k')::uuid and indicator_id = 'MATH-2560-P5-01'$$,
                     'ระหว่าง 0 ถึง 10', 'ปรับเกินคะแนนเต็ม → ปฏิเสธ');
select pg_temp.fails($$select public.gb_override_set(id, 6, 3) from gb_columns where classroom_id = current_setting('t.k')::uuid and indicator_id = 'MATH-2560-P5-01'$$,
                     'ไม่มีเลขที่ 6', 'ปรับเลขที่เกินจำนวนนักเรียน → ปฏิเสธ');
select public.scan_save_response(:'E2', 4, 1, pg_temp.ans(2, '{1}'), '{}', 'camera', true);
select pg_temp.ok(pg_temp.cell(4, 'MATH-2560-P5-01') = '5' and pg_temp.cell(4, 'MATH-2560-P5-01', 'real') = '2.00',
                  'ตรวจซ้ำแล้วคะแนนจริงเปลี่ยน แต่คะแนนที่ปรับยังคงไว้');
select public.scan_save_response(:'E2', 4, 1, pg_temp.ans(2, '{1,2}'), '{}', 'camera', true);

-- ===== จ) ปิดชุดแล้วคะแนนยังอยู่ · ชุดที่ผูกห้องไม่หมดอายุ =====
select pg_temp.ok((select bool_and(expires_at is null) from exams where classroom_id is not null)
                  and (select expires_at is not null from exams where id = :'P1'), 'ชุดที่ผูกห้องไม่มีวันหมดอายุ · ชุดฝึกยังหมดอายุ 60 วันเหมือนเดิม');
select public.exam_close(:'E2');
select pg_temp.ok(not exists (select 1 from responses where exam_id = :'E2') and (select count(*) from gb_attempts where exam_id = :'E2') = 4
                  and (select (closed_summary->>'items_recorded')::int from exams where id = :'E2') = 2,
                  'ปิดชุด E2: คำตอบรายเลขที่ถูกลบ สถิติเข้าคลัง แต่คะแนนในสมุดคะแนนยังอยู่');
select pg_temp.ok(pg_temp.vals('MATH-2560-P5-01') = '10 8 6 5 4', 'สมุดคะแนนหลังปิดชุดเหมือนเดิม');
select public.scan_delete_response(:'R1', 5);
select pg_temp.ok(not exists (select 1 from gb_attempts where exam_id = :'R1' and seat_no = 5) and pg_temp.cell(5, 'MATH-2560-P5-01', 'real') = '2.00',
                  'ลบผลตรวจระหว่างสอบ (ตรวจผิดแผ่น) → คะแนนของแผ่นนั้นหายด้วย');
select public.scan_save_response(:'R1', 5, 1, pg_temp.ans(6, '{1,2}'));

-- ===== ฉ) กันแก้ผิด + สิทธิ์ =====
select pg_temp.fails($$select public.gb_exam_link('00000000-0000-4000-e800-000000000001', null, 'practice')$$,
                     'มีผลตรวจแล้ว', 'เปลี่ยนประเภทชุดที่มีผลตรวจแล้ว → ปฏิเสธ');
select pg_temp.fails($$update exams set purpose = 'final' where id = '00000000-0000-4000-e800-000000000001'$$,
                     'มีผลตรวจแล้ว', 'แก้ตารางตรงเปลี่ยนประเภทชุดที่มีผลตรวจ → ปฏิเสธ');
select pg_temp.fails($$insert into gb_attempts(exam_id, seat_no, indicator_id, correct, total) values ('00000000-0000-4000-e800-000000000007', 1, 'MATH-2560-P5-01', 1, 1)$$,
                     'row-level security', 'เขียนคะแนนจริงเองตรง ๆ → ปฏิเสธ (ระบบเขียนจากผลตรวจเท่านั้น)');
update gb_overrides set score = 0;
select pg_temp.ok((select count(*) from gb_overrides where score = 0) = 0, 'แก้ตารางคะแนนที่ปรับตรง ๆ ไม่ได้ (ต้องผ่านฟังก์ชัน)');
select pg_temp.fails($$select public.gb_column_delete(id) from gb_columns where classroom_id = current_setting('t.k')::uuid and kind = 'final'$$,
                     'ลบช่องปลายภาคไม่ได้', 'ลบช่องปลายภาค → ปฏิเสธ');
select public.gb_column_delete(id) from gb_columns where classroom_id = current_setting('t.k')::uuid and indicator_id = 'MATH-2560-P5-02';
select public.gb_column_add(current_setting('t.k')::uuid, 'indicator', 'MATH-2560-P5-02', null, 20);
select pg_temp.ok(pg_temp.vals('MATH-2560-P5-02') = '20 7 20 0 0', 'ลบช่องตัวชี้วัดแล้วเพิ่มกลับ คะแนนจริงกลับมาครบ');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select pg_temp.ok((select count(*) from gb_classrooms) = 0 and (select count(*) from gb_columns) = 0 and (select count(*) from gb_attempts) = 0
                  and (select count(*) from gb_overrides) = 0, 'ครูคนอื่นไม่เห็นห้อง ช่อง คะแนน ของครู B');
select pg_temp.fails($$select public.gb_sheet(current_setting('t.k')::uuid)$$, 'ไม่พบห้องเรียน', 'ครูคนอื่นเปิดสมุดคะแนน → ปฏิเสธ');
select pg_temp.fails($$select public.gb_classroom_close(current_setting('t.k')::uuid)$$, 'ไม่พบห้องเรียน', 'ครูคนอื่นปิดเทอม → ปฏิเสธ');
select pg_temp.fails($$select public.gb_exam_link('00000000-0000-4000-e800-000000000006', current_setting('t.k')::uuid, 'collect')$$,
                     'ไม่พบชุดข้อสอบ', 'ครูคนอื่นผูกชุดเข้าห้อง → ปฏิเสธ');
select pg_temp.ok(public.gb_classroom_list() = '[]', 'รายการห้องของครูคนอื่นว่าง');
reset role;
set role anon;
select pg_temp.fails($$select public.gb_classroom_list()$$, 'permission denied', 'ไม่ล็อกอินเรียกฟังก์ชันไม่ได้');
reset role;

-- ===== ช) ปิดเทอม =====
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.ok((select (x->>'column_count')::int = 4 and (x->>'exam_count')::int = 6 and x->>'status' = 'open'
                   from jsonb_array_elements(public.gb_classroom_list()) x), 'รายการห้อง: 4 ช่อง 6 ชุดข้อสอบ');
select pg_temp.fails($$select public.gb_classroom_delete(current_setting('t.k')::uuid)$$, 'ปิดเทอมก่อน', 'ลบห้องที่มีคะแนนแล้วโดยไม่ปิดเทอม → ปฏิเสธ');
create temp table closed as select public.gb_classroom_close(current_setting('t.k')::uuid) as s;
select pg_temp.ok((select (s->>'exams_closed')::int = 4 and (s->>'attempts_deleted')::int > 0 and (s->>'overrides_deleted')::int = 2 from closed),
                  'ปิดเทอม: ปิดชุดที่ยังเปิด 4 ชุด (E1 R1 F1 E3) ลบคะแนนจริงและคะแนนที่ปรับ');
select pg_temp.ok(not exists (select 1 from gb_attempts) and not exists (select 1 from gb_overrides) and not exists (select 1 from gb_retake_choices)
                  and not exists (select 1 from responses r join exams e on e.id = r.exam_id where e.title <> 'ฝึก'),
                  'หลังปิดเทอมไม่เหลือข้อมูลรายเลขที่ของห้องเลย');
select pg_temp.ok((select s::text not like '%seat_no%' and s::text not like '%rows%' and (s->>'seat_count')::int = 5
                          and (select (c->>'mean')::numeric from jsonb_array_elements(s->'columns') c where c->>'kind' = 'final') = 9
                   from closed), 'ผลสรุปที่เก็บไว้เป็นค่ารวมระดับห้องเท่านั้น (ปลายภาคเฉลี่ย 9)');
select pg_temp.ok((select status = 'closed' and closed_summary is not null from gb_classrooms where id = current_setting('t.k')::uuid)
                  and (select count(*) from exams where classroom_id = current_setting('t.k')::uuid and status = 'closed') = 5
                  and (select purpose = 'practice' and classroom_id is null from exams where id = :'D1'),
                  'ห้องสถานะปิดเทอม · ชุดที่สอบแล้วปิดทั้งหมด · ชุดที่ยังไม่สอบ (D1) กลับเป็นชุดฝึก');
reset role;
select pg_temp.ok((select count(*) from item_stat_rounds where source_exam_id in (:'E1', :'R1', :'F1', :'E3')) = 6 + 6 + 6 + 1,
                  'สถิติรายข้อของทุกชุดเข้าคลังตอนปิดเทอม');
set role authenticated;
select pg_temp.fails($$select public.gb_column_add(current_setting('t.k')::uuid, 'indicator', 'MATH-2560-P5-04', null, 5)$$,
                     'ปิดเทอมแล้ว', 'แก้ห้องที่ปิดเทอมแล้ว → ปฏิเสธ');
select pg_temp.fails($$select public.gb_classroom_close(current_setting('t.k')::uuid)$$, 'ปิดเทอมแล้ว', 'ปิดเทอมซ้ำ → ปฏิเสธ');
select pg_temp.fails($$select public.gb_exam_link('00000000-0000-4000-e800-000000000008', current_setting('t.k')::uuid, 'collect')$$,
                     'ปิดเทอมแล้ว', 'ผูกชุดเข้าห้องที่ปิดเทอมแล้ว → ปฏิเสธ');
select pg_temp.ok(pg_temp.vals('final') = '- - - - -', 'เปิดสมุดคะแนนห้องที่ปิดเทอมแล้ว = ไม่มีคะแนนรายเลขที่');
select public.gb_classroom_create('{"name":"ป.5/1","grade_id":"P5","academic_year":2569,"term":2,"student_count":5}');
select pg_temp.ok((select count(*) from gb_classrooms where name = 'ป.5/1') = 2, 'ปิดเทอมแล้วสร้างห้องชื่อเดิมเทอมเดิมใหม่ได้');

-- ===== ซ) ลบห้อง/ลบชุด =====
select public.gb_classroom_delete(current_setting('t.k')::uuid);
select pg_temp.ok(not exists (select 1 from gb_classrooms where id = current_setting('t.k')::uuid)
                  and (select count(*) from exams where id in (:'E1', :'E2', :'R1', :'F1', :'E3')) = 5
                  and not exists (select 1 from exams where classroom_id = current_setting('t.k')::uuid),
                  'ลบห้องที่ปิดเทอมแล้ว: ชุดข้อสอบยังอยู่ (ยกเลิกผูกห้อง)');
select set_config('t.k', (select id::text from gb_classrooms where name = 'ป.5/1'), false);
reset role;
select pg_temp.mk_exam(:'X1', 'ลบชุด', '{a1}', 5, 9);
set role authenticated;
select public.gb_exam_link(:'X1', current_setting('t.k')::uuid, 'collect');
select public.scan_save_response(:'X1', 1, 1, pg_temp.ans(1, '{1}'));
select pg_temp.fails($$select public.gb_classroom_delete(current_setting('t.k')::uuid)$$, 'ปิดเทอมก่อน', 'ห้องใหม่มีคะแนนแล้ว ลบไม่ได้');
select public.exam_close(:'X1');
select public.exam_delete(:'X1');
select pg_temp.ok(not exists (select 1 from gb_attempts where exam_id = :'X1'), 'ลบชุดข้อสอบ → คะแนนของชุดนั้นในสมุดหายด้วย');
select public.gb_classroom_delete(current_setting('t.k')::uuid);
select pg_temp.ok(not exists (select 1 from gb_classrooms), 'ห้องที่ไม่มีคะแนนแล้วลบได้');
reset role;

delete from exams; delete from item_stat_rounds; delete from items; delete from calibration_runs;
select 'PASSED phase 8';
