-- ทดสอบ One Stop เฟส 5: ปิดเทอม "แบบเดียวกับที่เว็บส่งจริง" (web/src/data/supabaseRepo.ts)
--   closeClassroom → rpc('gb_classroom_close', { p_classroom }) · หน้าสรุปปิดเทอมอ่าน gb_classrooms.closed_summary ตรงผ่าน RLS
--   ตรวจคีย์ JSON ที่ toClassroomCloseSummary อ่าน + ค่าที่คำนวณมือ + หลังปิดไม่เหลือข้อมูลรายเลขที่ + สิทธิ์
--   (ส่งออกชีทไม่แตะฐานข้อมูล — ใช้ gb_sheet ตัวเดียวกับสมุดคะแนน ทดสอบใน test_phase9b_web.sql แล้ว · รายชื่อไม่ขึ้นเซิร์ฟเวอร์)
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
create temp table pl as select (k - 1)::int as k, plan from fx, jsonb_array_elements(doc->'plans') with ordinality t(plan, k);
grant select on fx, pl to authenticated;

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'term-teacher@test'),
  ('00000000-0000-0000-0000-0000000000d2', 'term-other@test')
on conflict (id) do nothing;
delete from exams; delete from item_stat_rounds; delete from items; delete from calibration_runs; delete from gb_classrooms;
insert into items(id, item_code, owner_id, subject_id, indicator_id, item_type, cognitive_level, est_difficulty, current_difficulty, status, no_shuffle)
select (p->>'id')::uuid, p->>'item_code', '00000000-0000-0000-0000-0000000000d1', 'MATH', p->>'indicator_id', 'mcq4', 1,
       (p->>'difficulty')::int, (p->>'difficulty')::int, 'reviewed', (p->>'no_shuffle')::boolean
from fx, jsonb_array_elements(doc->'pool') p;
insert into item_versions(item_id, version, content, answer, qa)
select (p->>'id')::uuid, 1,
       jsonb_build_object('stem', 'โจทย์', 'options', jsonb_build_array('ก', 'ข', 'ค', 'ง'), 'figure', null,
                          'explanation', '', 'distractor_rationale', jsonb_build_array(null, null, null, null)),
       jsonb_build_object('choice', (p->>'answer')::int), '{"passed": true, "errors": [], "warnings": []}'::jsonb
from fx, jsonb_array_elements(doc->'pool') p;
set client_min_messages = notice;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);

-- ห้อง ป.5/1 นักเรียน 9 คน ตัวชี้วัดตามแผน 1 (เต็ม 10) · ชุดเก็บคะแนน e1 + สอบซ่อม r1
select set_config('t.room', public.gb_classroom_create(p => jsonb_build_object(
  'grade_id', 'P5', 'academic_year', 2569, 'term', 2, 'name', 'ป.5/1', 'student_count', 9,
  'indicators', (select jsonb_agg(distinct jsonb_build_object('indicator_id', r->>'indicator_id', 'max_score', 10))
                 from pl, jsonb_array_elements(plan->'rows') r where k = 1)))::text, false);
select set_config('t.e1', public.exam_create_linked(p => (select plan from pl where k = 1)
  || jsonb_build_object('classroom_id', current_setting('t.room'), 'purpose', 'collect', 'retake_of', null))::text, false);
select set_config('t.r1', public.exam_create_linked(p => (select plan from pl where k = 0)
  || jsonb_build_object('classroom_id', current_setting('t.room'), 'purpose', 'collect', 'retake_of', current_setting('t.e1')))::text, false);
select set_config('t.col', (select id::text from gb_columns where classroom_id = current_setting('t.room')::uuid and kind = 'indicator'
                            order by sort limit 1), false);
select set_config('t.ind', (select indicator_id from gb_columns where id = current_setting('t.col')::bigint), false);

create or replace function pg_temp.answers(p_exam uuid, p_seat int, p_correct boolean) returns jsonb language sql as $$
  select jsonb_agg(case when p_correct then (e->>'key')::int else ((e->>'key')::int % 4) + 1 end order by (e->>'position')::int)
  from jsonb_array_elements(public.exam_get(p_exam)->'sets') s, jsonb_array_elements(s->'entries') e
  where (s->>'set_no')::int = (select set_no from exam_seats where exam_id = p_exam and seat_no = p_seat)
$$;
create or replace function pg_temp.scan(p_exam text, p_seat int, p_correct boolean) returns void language sql as $$
  select null::void from (select public.scan_save_response(p_exam => p_exam::uuid, p_seat => p_seat,
    p_set => (select set_no from exam_seats where exam_id = p_exam::uuid and seat_no = p_seat),
    p_answers => pg_temp.answers(p_exam::uuid, p_seat, p_correct), p_replace => true)) x
$$;
-- เลขที่ 1 ผิดหมดใน e1 แล้วถูกหมดในสอบซ่อม · เลขที่ 2 ถูกหมดใน e1 · คนอื่นขาดสอบ
select pg_temp.scan(current_setting('t.e1'), 1, false);
select pg_temp.scan(current_setting('t.e1'), 2, true);
select pg_temp.scan(current_setting('t.r1'), 1, true);


-- เลขที่ 1: ผิดหมด e1 → ถูกหมดสอบซ่อม (นับสูงสุด = เต็ม) · เลขที่ 2 ถูกหมด e1 · เลขที่ 3–9 ขาด (นับ 0) · ปรับเลขที่ 3 ให้ผ่าน แล้วยกเลิกไม่ทำ
select pg_temp.scan(current_setting('t.e1'), 1, false);
select pg_temp.scan(current_setting('t.e1'), 2, true);
select pg_temp.scan(current_setting('t.r1'), 1, true);
select public.gb_override_set(p_column => current_setting('t.col')::bigint, p_seat => 3, p_score => 5, p_reason => 'pass');
-- ชุดที่ยังไม่มีใครสอบ (k = 2) ผูกห้องไว้ → ปิดเทอมแล้วต้องกลับเป็นชุดฝึก
select set_config('t.unused', public.exam_create_linked(p => (select plan from pl where k = 1)
  || jsonb_build_object('classroom_id', current_setting('t.room'), 'purpose', 'collect', 'retake_of', null))::text, false);
select set_config('t.att', (select count(*)::text from public.gb_attempts where exam_id in (current_setting('t.e1')::uuid, current_setting('t.r1')::uuid)), false);
select set_config('t.sum_before', (select sum((r->>'total')::numeric)::text from jsonb_array_elements(public.gb_sheet(p_classroom => current_setting('t.room')::uuid)->'rows') r), false);

-- ครูอื่นปิดเทอมห้องนี้ไม่ได้
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', false);
select pg_temp.fails($q$select public.gb_classroom_close(p_classroom => current_setting('t.room')::uuid)$q$, 'ไม่พบห้องเรียน', 'ครูอื่นปิดเทอม → ปฏิเสธ');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);

-- ===== closeClassroom: rpc('gb_classroom_close', { p_classroom }) =====
create temp table cs as select public.gb_classroom_close(p_classroom => current_setting('t.room')::uuid) as j;
grant select on cs to authenticated;
select pg_temp.ok((select j ?& array['seat_count','columns','total_mean','exams_closed','attempts_deleted','overrides_deleted','closed_at'] from cs),
  'ผลปิดเทอมมีคีย์ระดับบนครบตามที่ toClassroomCloseSummary อ่าน');
select pg_temp.ok((select bool_and(c ?& array['kind','indicator_id','label','max_score','collected','mean','min','max']) from cs, jsonb_array_elements(j->'columns') c),
  'คีย์ของแต่ละช่องครบ');
select pg_temp.ok((select (j->>'seat_count')::int = 9 and (j->>'exams_closed')::int = 2 and (j->>'overrides_deleted')::int = 1
                          and (j->>'attempts_deleted')::int = current_setting('t.att')::int and current_setting('t.att')::int > 0 from cs),
  'นักเรียน 9 · ปิดชุดที่ยังเปิด 2 ชุด (e1 + สอบซ่อม) · ลบคะแนนที่ปรับ 1 · ลบคะแนนรายชุดครบทุกแถว');
-- ช่องแรก: เลขที่ 1, 2 = 10 · เลขที่ 3 ปรับ 5 · ที่เหลือ 0 → เฉลี่ย 25/9 = 2.78 · ต่ำสุด 0 · สูงสุด 10
select pg_temp.ok((select (c->>'mean')::numeric = 2.78 and (c->>'min')::numeric = 0 and (c->>'max')::numeric = 10 and (c->>'collected')::boolean
                   from cs, jsonb_array_elements(j->'columns') c where c->>'indicator_id' = current_setting('t.ind')),
  'ช่องตัวชี้วัดแรก: เฉลี่ย 2.78 ต่ำสุด 0 สูงสุด 10 (คะแนนที่ปรับนับในค่าสรุป)');
select pg_temp.ok((select c->'mean' = 'null'::jsonb and not (c->>'collected')::boolean and (c->>'max_score')::numeric = 30
                   from cs, jsonb_array_elements(j->'columns') c where c->>'kind' = 'final'),
  'ปลายภาคยังไม่เก็บ: เฉลี่ยว่าง (เต็ม 30 ค่าเริ่มต้น)');
select pg_temp.ok((select (j->>'total_mean')::numeric = round(current_setting('t.sum_before')::numeric / 9, 2) from cs),
  'คะแนนรวมเฉลี่ย = ผลรวมก่อนปิด ÷ 9');

-- ===== หลังปิด: หน้าสรุปอ่าน gb_classrooms ตรง (getClassroom) =====
select pg_temp.ok((select status = 'closed' and closed_at is not null and closed_summary = (select j from cs)
                   from public.gb_classrooms where id = current_setting('t.room')::uuid),
  'อ่าน gb_classrooms ผ่าน RLS: status closed + closed_summary = ผลที่คืน');
select pg_temp.ok(not exists (select 1 from public.gb_attempts where exam_id in (select id from exams where classroom_id = current_setting('t.room')::uuid))
                  and not exists (select 1 from public.gb_overrides) and not exists (select 1 from public.gb_retake_choices)
                  and not exists (select 1 from public.responses where exam_id in (current_setting('t.e1')::uuid, current_setting('t.r1')::uuid)),
  'ไม่เหลือข้อมูลรายเลขที่: คะแนนรายชุด / คะแนนที่ปรับ / การเลือกสอบซ่อม / คำตอบ');
select pg_temp.ok((select classroom_id is null and purpose = 'practice' from public.exams where id = current_setting('t.unused')::uuid),
  'ชุดที่ยังไม่มีใครสอบ → กลับเป็นชุดฝึก ไม่ผูกห้อง');
select pg_temp.ok((select bool_and(status = 'closed') from public.exams where id in (current_setting('t.e1')::uuid, current_setting('t.r1')::uuid)),
  'ชุดที่สอบแล้วถูกปิด');
select pg_temp.ok((select bool_and((c->>'value') is null) from jsonb_array_elements(public.gb_sheet(p_classroom => current_setting('t.room')::uuid)->'rows') r,
                   jsonb_array_elements(r->'cells') c),
  'เปิดสมุดของห้องที่ปิดแล้วได้ แต่ไม่มีคะแนนรายเลขที่');
select pg_temp.fails($q$select public.gb_classroom_close(p_classroom => current_setting('t.room')::uuid)$q$, 'ปิดเทอมแล้ว', 'ปิดเทอมซ้ำ → ปฏิเสธ');
select pg_temp.fails($q$select public.gb_override_set(p_column => current_setting('t.col')::bigint, p_seat => 1, p_score => 1, p_reason => 'pass')$q$,
  'ปิดเทอมแล้ว', 'ปรับคะแนนหลังปิดเทอม → ปฏิเสธ');
-- เปิดห้องชื่อเดิมเทอมเดิมใหม่ได้ · ลบห้องเก่าได้
select public.gb_classroom_create(p => jsonb_build_object('grade_id', 'P5', 'academic_year', 2569, 'term', 2, 'name', 'ป.5/1', 'student_count', 9));
select public.gb_classroom_delete(p_classroom => current_setting('t.room')::uuid);
select pg_temp.ok((select count(*) = 1 and bool_and(status = 'open') from public.gb_classrooms), 'ห้องใหม่ชื่อเดิมเปิดได้ · ลบห้องที่ปิดแล้วได้');
reset role;

\echo 'test_phase9c_web: ALL PASSED'
