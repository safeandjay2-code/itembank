-- ทดสอบ One Stop เฟส 3: สร้างชุดข้อสอบผูกห้อง + ประเภทการสอบ (migration 0012) และผลตรวจไหลเข้าคะแนนสะสม
--   ใช้แผนชุดข้อสอบจริงจากอัลกอริทึมหน้าเว็บ (fixtures/phase3_plans.json) และเรียกฟังก์ชันด้วยชื่อพารามิเตอร์แบบเดียวกับเว็บ
--   (supabaseRepo.createExam → rpc('exam_create_linked', { p }))
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

\set fx `cat tests/db/fixtures/phase3_plans.json`
create temp table fx as select :'fx'::jsonb as doc;
-- แผน 0 = ป.5 นักเรียน 5 คน · แผน 1 = ป.5 นักเรียน 9 คน 2 ชุด
create temp table pl as select (k - 1)::int as k, plan from fx, jsonb_array_elements(doc->'plans') with ordinality t(plan, k);
grant select on fx, pl to authenticated;

-- ===== 0) ผู้ใช้และคลัง (เหมือน test_phase3) =====
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'link-teacher@test'),
  ('00000000-0000-0000-0000-0000000000c2', 'link-other@test')
on conflict (id) do nothing;
delete from exams; delete from item_stat_rounds; delete from items; delete from calibration_runs; delete from gb_classrooms;
insert into items(id, item_code, owner_id, subject_id, indicator_id, item_type, cognitive_level, est_difficulty, current_difficulty, status, no_shuffle)
select (p->>'id')::uuid, p->>'item_code', '00000000-0000-0000-0000-0000000000c1', 'MATH', p->>'indicator_id', 'mcq4', 1,
       (p->>'difficulty')::int, (p->>'difficulty')::int, 'reviewed', (p->>'no_shuffle')::boolean
from fx, jsonb_array_elements(doc->'pool') p;
insert into item_versions(item_id, version, content, answer, qa)
select (p->>'id')::uuid, 1,
       jsonb_build_object('stem', 'โจทย์', 'options', jsonb_build_array('ก', 'ข', 'ค', 'ง'), 'figure', null,
                          'explanation', '', 'distractor_rationale', jsonb_build_array(null, null, null, null)),
       jsonb_build_object('choice', (p->>'answer')::int), '{"passed": true, "errors": [], "warnings": []}'::jsonb
from fx, jsonb_array_elements(doc->'pool') p;
insert into item_stat_rounds(item_id, version, grade_id, n, n_correct, r)
select (p->>'id')::uuid, 1, 'P5', (p->>'n')::int, (p->>'n')::int / 2, 0.3
from fx, jsonb_array_elements(doc->'pool') p where (p->>'n')::int > 0;
set client_min_messages = notice;

select pg_temp.ok(exists (select 1 from app_migrations where version = '0012'), 'บันทึก migration 0012');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);

-- ห้อง ป.5/1 นักเรียน 9 คน (ตัวชี้วัดตามแผน 1) · ห้อง ป.4/1 (ใช้ทดสอบชั้นไม่ตรง)
select set_config('t.room', public.gb_classroom_create(p => jsonb_build_object(
  'grade_id', 'P5', 'academic_year', 2569, 'term', 2, 'name', 'ป.5/1', 'student_count', 9,
  'indicators', (select jsonb_agg(distinct jsonb_build_object('indicator_id', r->>'indicator_id', 'max_score', 10))
                 from pl, jsonb_array_elements(plan->'rows') r where k = 1)))::text, false);
select set_config('t.room4', public.gb_classroom_create(p => '{"grade_id":"P4","academic_year":2569,"term":2,"name":"ป.4/1","student_count":9}'::jsonb)::text, false);

-- ===== 1) สร้างชุดเก็บคะแนนผูกห้องในคำสั่งเดียว =====
select set_config('t.e1', public.exam_create_linked(p => (select plan from pl where k = 1)
  || jsonb_build_object('classroom_id', current_setting('t.room'), 'purpose', 'collect', 'retake_of', null))::text, false);
select pg_temp.ok((select classroom_id = current_setting('t.room')::uuid and purpose = 'collect' and retake_of is null
                   and status = 'draft' and student_count = 9 from exams where id = current_setting('t.e1')::uuid),
  'exam_create_linked: สร้างชุดเก็บคะแนนผูกห้องได้ในคำสั่งเดียว');
select pg_temp.ok((select (x->>'exam_count')::int from jsonb_array_elements(public.gb_classroom_list()) x where x->>'id' = current_setting('t.room')) = 1,
  'รายการห้องนับชุดข้อสอบที่ผูกแล้ว');

-- ===== 2) ผิดข้อใด = ไม่สร้างอะไรเลย =====
create temp table cnt as select count(*) as n from exams;
select pg_temp.fails($q$select public.exam_create_linked(p => (select plan from pl where k = 0)
  || jsonb_build_object('classroom_id', current_setting('t.room'), 'purpose', 'collect'))$q$,
  'ตั้งจำนวนนักเรียนของชุดให้ครบทั้งห้อง', 'ชุดเก็บคะแนนที่เลขที่ไม่ครบห้อง (5 < 9) ถูกปฏิเสธ');
select pg_temp.fails($q$select public.exam_create_linked(p => (select plan from pl where k = 1)
  || jsonb_build_object('classroom_id', current_setting('t.room4'), 'purpose', 'collect'))$q$,
  'ชั้นของชุดข้อสอบไม่ตรงกับชั้นของห้อง', 'ชุด ป.5 ผูกห้อง ป.4 ไม่ได้');
select pg_temp.fails($q$select public.exam_create_linked(p => (select plan from pl where k = 1) || '{"purpose":"final"}'::jsonb)$q$,
  'ต้องเลือกห้องเรียน', 'ชุดปลายภาคต้องเลือกห้อง');
select pg_temp.fails($q$select public.exam_create_linked(p => (select plan from pl where k = 1)
  || jsonb_build_object('classroom_id', current_setting('t.room'), 'purpose', 'grade'))$q$,
  'ประเภทการสอบไม่ถูกต้อง', 'ประเภทการสอบที่ไม่รู้จักถูกปฏิเสธ');
select pg_temp.fails($q$select public.exam_create_linked(p => (select plan from pl where k = 1) || '{"classroom_id":"ห้อง1","purpose":"collect"}'::jsonb)$q$,
  'ข้อมูลห้องเรียน', 'รหัสห้องผิดรูปแบบถูกปฏิเสธ');
select pg_temp.fails($q$select public.exam_create_linked(p => (select plan from pl where k = 1)
  || jsonb_build_object('classroom_id', current_setting('t.room'), 'purpose', 'final', 'retake_of', current_setting('t.e1')))$q$,
  'ประเภทการสอบเดียวกับชุดเดิม', 'สอบซ่อมต้องเป็นประเภทเดียวกับชุดเดิม');
select pg_temp.ok((select count(*) from exams) = (select n from cnt), 'คำสั่งที่ถูกปฏิเสธไม่ทิ้งชุดข้อสอบค้างไว้');

-- ===== 3) ชุดฝึก (ไม่ส่งข้อมูลห้อง) = เหมือน exam_create เดิม · ปลายภาค · สอบซ่อม =====
select set_config('t.p1', public.exam_create_linked(p => (select plan from pl where k = 0))::text, false);
select pg_temp.ok((select purpose = 'practice' and classroom_id is null from exams where id = current_setting('t.p1')::uuid),
  'ไม่ส่งข้อมูลห้อง = ชุดฝึกแบบเดิม');
select set_config('t.p2', public.exam_create_linked(p => (select plan from pl where k = 0) || '{"purpose":"practice","classroom_id":null}'::jsonb)::text, false);
select pg_temp.ok((select purpose = 'practice' and classroom_id is null from exams where id = current_setting('t.p2')::uuid),
  'เลือก "ฝึก" ไม่ผูกห้องได้');
select set_config('t.f1', public.exam_create_linked(p => (select plan from pl where k = 1)
  || jsonb_build_object('classroom_id', current_setting('t.room'), 'purpose', 'final'))::text, false);
select pg_temp.ok((select purpose = 'final' from exams where id = current_setting('t.f1')::uuid), 'สร้างชุดปลายภาคผูกห้อง');
select set_config('t.r1', public.exam_create_linked(p => (select plan from pl where k = 0)
  || jsonb_build_object('classroom_id', current_setting('t.room'), 'purpose', 'collect', 'retake_of', current_setting('t.e1')))::text, false);
select pg_temp.ok((select retake_of = current_setting('t.e1')::uuid and purpose = 'collect' from exams where id = current_setting('t.r1')::uuid),
  'สอบซ่อม: เลขที่ไม่ต้องครบห้อง (5 คน) ผูกกับชุดเดิมได้');

-- ===== 4) ผลตรวจ → คะแนนสะสม =====
-- เลขที่ 1: ตอบถูกทุกข้อ · เลขที่ 2: ตอบผิดทุกข้อ (คำตอบตามชุดของเลขที่นั้น)
create or replace function pg_temp.answers(p_exam uuid, p_seat int, p_correct boolean) returns jsonb language sql as $$
  select jsonb_agg(case when p_correct then (e->>'key')::int else ((e->>'key')::int % 4) + 1 end order by (e->>'position')::int)
  from jsonb_array_elements(public.exam_get(p_exam)->'sets') s, jsonb_array_elements(s->'entries') e
  where (s->>'set_no')::int = (select set_no from exam_seats where exam_id = p_exam and seat_no = p_seat)
$$;
select public.scan_save_response(p_exam => current_setting('t.e1')::uuid, p_seat => 1, p_set => (select set_no from exam_seats where exam_id = current_setting('t.e1')::uuid and seat_no = 1),
  p_answers => pg_temp.answers(current_setting('t.e1')::uuid, 1, true));
select public.scan_save_response(p_exam => current_setting('t.e1')::uuid, p_seat => 2, p_set => (select set_no from exam_seats where exam_id = current_setting('t.e1')::uuid and seat_no = 2),
  p_answers => pg_temp.answers(current_setting('t.e1')::uuid, 2, false));
select pg_temp.ok((select sum(correct) = (select item_count from exams where id = current_setting('t.e1')::uuid) and sum(total) = sum(correct)
                   from gb_attempts where exam_id = current_setting('t.e1')::uuid and seat_no = 1),
  'ตรวจแล้วคะแนนเข้าคะแนนสะสมเอง: เลขที่ 1 ถูกครบทุกข้อ');
select pg_temp.ok((select sum(correct) = 0 and sum(total) = (select item_count from exams where id = current_setting('t.e1')::uuid)
                   from gb_attempts where exam_id = current_setting('t.e1')::uuid and seat_no = 2),
  'เลขที่ 2 ผิดทุกข้อ = 0 คะแนน (ไม่ใช่ขาดสอบ)');
select pg_temp.ok((select count(distinct indicator_id) from gb_attempts where exam_id = current_setting('t.e1')::uuid and seat_no = 1)
                  = (select count(distinct r->>'indicator_id') from pl, jsonb_array_elements(plan->'rows') r where k = 1),
  'คะแนนแยกลงทุกตัวชี้วัดในชุด');
-- สมุดคะแนน: เลขที่ 1 เต็มทุกช่องตัวชี้วัด (10) · เลขที่ 2 ได้ 0
select pg_temp.ok((select bool_and((c->>'value')::numeric = 10) from jsonb_array_elements(public.gb_sheet(current_setting('t.room')::uuid)->'rows') r,
                   jsonb_array_elements(r->'cells') c where (r->>'seat_no')::int = 1 and (c->>'column_id')::bigint in (select id from gb_columns where kind = 'indicator'))
                  and (select bool_and((c->>'value')::numeric = 0) from jsonb_array_elements(public.gb_sheet(current_setting('t.room')::uuid)->'rows') r,
                   jsonb_array_elements(r->'cells') c where (r->>'seat_no')::int = 2 and (c->>'column_id')::bigint in (select id from gb_columns where kind = 'indicator')),
  'สมุดคะแนน: เลขที่ 1 = 10 ทุกตัวชี้วัด · เลขที่ 2 = 0');

-- ===== 5) หลังมีผลตรวจ เปลี่ยนห้อง/ประเภทไม่ได้ · ก่อนมีผลตรวจเปลี่ยนได้ (และกติกาห้อง/ชั้นยังใช้) =====
select pg_temp.fails($q$select public.gb_exam_link(p_exam => current_setting('t.e1')::uuid, p_classroom => current_setting('t.room')::uuid, p_purpose => 'practice', p_retake_of => null)$q$,
  'มีผลตรวจแล้ว', 'ชุดที่มีผลตรวจแล้วเปลี่ยนประเภทไม่ได้');
select public.gb_exam_link(p_exam => current_setting('t.p1')::uuid, p_classroom => current_setting('t.room')::uuid, p_purpose => 'collect', p_retake_of => current_setting('t.e1')::uuid);
select pg_temp.ok((select classroom_id = current_setting('t.room')::uuid and retake_of = current_setting('t.e1')::uuid from exams where id = current_setting('t.p1')::uuid),
  'ชุดฝึกที่ยังไม่สอบ เปลี่ยนเป็นสอบซ่อมของห้องได้ภายหลัง');
select pg_temp.fails($q$select public.gb_exam_link(p_exam => current_setting('t.p2')::uuid, p_classroom => current_setting('t.room')::uuid, p_purpose => 'collect', p_retake_of => null)$q$,
  'ตั้งจำนวนนักเรียนของชุดให้ครบทั้งห้อง', 'เปลี่ยนเป็นชุดเก็บคะแนนภายหลังก็ต้องมีเลขที่ครบห้อง');
select pg_temp.fails($q$select public.gb_exam_link(p_exam => current_setting('t.p2')::uuid, p_classroom => current_setting('t.room4')::uuid, p_purpose => 'practice', p_retake_of => null)$q$,
  'ชั้นของชุดข้อสอบไม่ตรง', 'ผูกห้องคนละชั้นภายหลังไม่ได้');
select public.gb_exam_link(p_exam => current_setting('t.p1')::uuid, p_classroom => null, p_purpose => 'practice', p_retake_of => null);
select pg_temp.ok((select classroom_id is null and purpose = 'practice' and retake_of is null and expires_at is null and status = 'draft'
                   from exams where id = current_setting('t.p1')::uuid), 'ยกเลิกผูกห้องกลับเป็นชุดฝึกได้');

-- ===== 6) ครูอื่นใช้ห้องของเราไม่ได้ · ไม่ล็อกอินเรียกไม่ได้ =====
reset role;
create temp table cnt_all as select count(*) as n from exams;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false);
select pg_temp.fails($q$select public.exam_create_linked(p => (select plan from pl where k = 1)
  || jsonb_build_object('classroom_id', current_setting('t.room'), 'purpose', 'collect'))$q$,
  'ไม่พบห้องเรียน', 'ครูอื่นสร้างชุดผูกห้องที่ไม่ใช่ของตัวเองไม่ได้');
reset role;
select pg_temp.ok((select count(*) from exams) = (select n from cnt_all), 'ครูอื่นถูกปฏิเสธแล้วไม่มีชุดค้าง');
select pg_temp.ok(not has_function_privilege('anon', 'public.exam_create_linked(jsonb)', 'execute')
                  and has_function_privilege('authenticated', 'public.exam_create_linked(jsonb)', 'execute'),
  'สิทธิ์: ไม่ล็อกอินเรียก exam_create_linked ไม่ได้');

-- ===== 7) ลบชุดที่มีคะแนนในสมุด (หลังปิดชุด) = คะแนนของชุดนั้นหายด้วย — หน้าเว็บต้องเตือนก่อนลบ =====
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select public.exam_close(p_exam => current_setting('t.e1')::uuid);
select pg_temp.ok((select count(*) from gb_attempts where exam_id = current_setting('t.e1')::uuid) > 0,
  'ปิดชุดแล้ว คะแนนในสมุดยังอยู่ (อ่านผ่าน RLS ได้ — หน้าเว็บใช้นับก่อนลบ)');
select public.exam_delete(p_exam => current_setting('t.e1')::uuid);
reset role;
select pg_temp.ok((select count(*) from gb_attempts where exam_id = current_setting('t.e1')::uuid) = 0,
  'ลบชุดแล้วคะแนนของชุดนั้นในสมุดหายด้วย');
select pg_temp.ok((select retake_of is null and classroom_id = current_setting('t.room')::uuid and purpose = 'collect' and student_count = 5
                   from exams where id = current_setting('t.r1')::uuid),
  'ลบชุดแรกของกลุ่ม → สอบซ่อมกลายเป็นชุดเก็บคะแนนปกติของห้อง (ไม่ติดกติกาเลขที่ครบห้อง)');

\echo 'test_phase9: ALL PASSED'
