-- ทดสอบ One Stop เฟส 4: หน้าสมุดคะแนนเรียกฐานข้อมูล "แบบเดียวกับที่เว็บส่งจริง" (web/src/data/supabaseRepo.ts)
--   getGradebook → rpc('gb_sheet', { p_classroom }) + อ่าน gb_attempts / gb_retake_choices ตรงผ่าน RLS (.in(exam_id))
--   setOverride → rpc('gb_override_set', { p_column, p_seat, p_score, p_reason }) · chooseRetake → rpc('gb_retake_choose', { p_root, p_seat, p_chosen })
--   ตรวจคีย์ JSON ที่ toGbSheet อ่าน — ถ้าใครเปลี่ยนชื่อพารามิเตอร์/รูป JSON ฝั่งใดฝั่งหนึ่ง ทดสอบนี้จะพัง
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
  ('00000000-0000-0000-0000-0000000000d1', 'book-teacher@test'),
  ('00000000-0000-0000-0000-0000000000d2', 'book-other@test')
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

-- ===== getGradebook: rpc('gb_sheet', { p_classroom }) — คีย์ทุกระดับที่ toGbSheet อ่าน =====
create temp table sh as select public.gb_sheet(p_classroom => current_setting('t.room')::uuid) as s;
grant select on sh to authenticated;
select pg_temp.ok((select s ?& array['classroom','seat_count','columns','rows','totals','unplanned_indicators','exams'] from sh),
  'gb_sheet คืนคีย์ระดับบนครบ');
select pg_temp.ok((select s->'classroom' ?& array['id','name','subject_id','grade_id','academic_year','term','student_count','status','settings']
                   and s->'classroom'->'settings' ?& array['rounding','aggregation','retake_policy','absent_policy','show_other_columns'] from sh),
  'classroom + settings ที่ใช้จริง (รวมค่าเริ่มต้นของระบบ) ครบ');
select pg_temp.ok((select bool_and(c ?& array['id','kind','indicator_id','code','standard_code','indicator_code','text','label','max_score','sort','collected','groups'])
                   from sh, jsonb_array_elements(s->'columns') c), 'คีย์ของช่องครบ');
select pg_temp.ok((select bool_and(g ?& array['root','item_total','exams']) from sh, jsonb_array_elements(s->'columns') c, jsonb_array_elements(c->'groups') g),
  'คีย์ของกลุ่มการสอบครบ');
select pg_temp.ok((select bool_and(r ?& array['seat_no','cells','total_collect','total_final','total']) from sh, jsonb_array_elements(s->'rows') r)
                  and (select bool_and(x ?& array['column_id','raw_correct','raw_total','real','adjusted','reason','value','missing'])
                       from sh, jsonb_array_elements(s->'rows') r, jsonb_array_elements(r->'cells') x),
  'คีย์ของแถว/ช่องคะแนนครบ');
select pg_temp.ok((select s->'totals' ?& array['collect_max','final_max','max','unset_columns'] from sh)
                  and (select bool_and(e ?& array['id','title','purpose','retake_of','status','created_at']) from sh, jsonb_array_elements(s->'exams') e),
  'totals + exams ครบ');
select pg_temp.ok((select (c->>'value')::numeric = 10 and c->'missing' = '[]'::jsonb
                   from sh, jsonb_array_elements(s->'rows') r, jsonb_array_elements(r->'cells') c
                   where (r->>'seat_no')::int = 1 and (c->>'column_id')::bigint = current_setting('t.col')::bigint),
  'สอบซ่อมนับครั้งสูงสุด: เลขที่ 1 (0 → เต็ม) = 10');
select pg_temp.ok((select jsonb_array_length(c->'missing') = 1 from sh, jsonb_array_elements(s->'rows') r, jsonb_array_elements(r->'cells') c
                   where (r->>'seat_no')::int = 3 and (c->>'column_id')::bigint = current_setting('t.col')::bigint),
  'เลขที่ 3 ขาดสอบ → มีป้ายขาด');

-- อ่านคะแนนรายชุดตรง (supabaseRepo: from('gb_attempts').select(...).in('exam_id', ids))
select pg_temp.ok((select count(distinct exam_id) = 2 and bool_and(correct <= total) from public.gb_attempts
                   where exam_id in (select (e->>'id')::uuid from sh, jsonb_array_elements(s->'exams') e)),
  'อ่าน gb_attempts ของชุดในห้องผ่าน RLS ได้ (2 ชุด)');

-- ===== setOverride: rpc('gb_override_set', { p_column, p_seat, p_score, p_reason }) =====
select public.gb_override_set(p_column => current_setting('t.col')::bigint, p_seat => 3, p_score => 5, p_reason => 'pass');
select pg_temp.ok((select (c->>'value')::numeric = 5 and (c->>'real')::numeric = 0 and c->>'reason' = 'pass'
                   from jsonb_array_elements(public.gb_sheet(p_classroom => current_setting('t.room')::uuid)->'rows') r, jsonb_array_elements(r->'cells') c
                   where (r->>'seat_no')::int = 3 and (c->>'column_id')::bigint = current_setting('t.col')::bigint),
  'ปรับให้ผ่าน (ชื่อพารามิเตอร์ของเว็บ): ลงชีท 5 · คะแนนจริง 0');
select public.gb_override_set(p_column => current_setting('t.col')::bigint, p_seat => 3, p_score => null, p_reason => 'manual');
select pg_temp.ok(not exists (select 1 from public.gb_overrides where column_id = current_setting('t.col')::bigint),
  'p_score = null → ยกเลิกการปรับ');
select pg_temp.fails($q$select public.gb_override_set(p_column => current_setting('t.col')::bigint, p_seat => 10, p_score => 5, p_reason => 'pass')$q$,
  'ไม่มีเลขที่ 10', 'ปรับเลขที่เกินห้อง → ปฏิเสธ');

-- ===== chooseRetake: rpc('gb_retake_choose', { p_root, p_seat, p_chosen }) =====
select public.gb_classroom_update(p_classroom => current_setting('t.room')::uuid, p => '{"settings": {"retake_policy": "manual"}}'::jsonb);
select public.gb_retake_choose(p_root => current_setting('t.e1')::uuid, p_seat => 1, p_chosen => current_setting('t.e1')::uuid);
select pg_temp.ok((select (c->>'value')::numeric = 0
                   from jsonb_array_elements(public.gb_sheet(p_classroom => current_setting('t.room')::uuid)->'rows') r, jsonb_array_elements(r->'cells') c
                   where (r->>'seat_no')::int = 1 and (c->>'column_id')::bigint = current_setting('t.col')::bigint)
                  and (select count(*) = 1 from public.gb_retake_choices where root_exam_id = current_setting('t.e1')::uuid),
  'ครูเลือกนับครั้งแรก: เลขที่ 1 = 0 · อ่าน gb_retake_choices ผ่าน RLS ได้');
select public.gb_retake_choose(p_root => current_setting('t.e1')::uuid, p_seat => 1, p_chosen => null);
select pg_temp.ok(not exists (select 1 from public.gb_retake_choices), 'p_chosen = null → ยกเลิกการเลือก');

-- ===== เพิ่มเป็นช่อง (ตัวชี้วัดที่มีคะแนนแต่ไม่มีช่อง) =====
select public.gb_column_delete(p_column => current_setting('t.col')::bigint);
select pg_temp.ok((select s->'unplanned_indicators' ? current_setting('t.ind') from (select public.gb_sheet(p_classroom => current_setting('t.room')::uuid) s) x),
  'ลบช่องแล้ว ตัวชี้วัดนั้นขึ้นใน unplanned_indicators');
select public.gb_column_add(p_classroom => current_setting('t.room')::uuid, p_kind => 'indicator', p_indicator => current_setting('t.ind'), p_label => null, p_max => null);
select pg_temp.ok((select not (s->'unplanned_indicators' ? current_setting('t.ind')) and (s->'totals'->>'unset_columns')::int = 1
                   from (select public.gb_sheet(p_classroom => current_setting('t.room')::uuid) s) x),
  'กด "เพิ่มเป็นช่อง" (คะแนนเต็มว่าง) → หายจากรายการ · ยังไม่ตั้งคะแนน 1 ช่อง');

-- ===== ครูอื่นอ่าน/แก้ไม่ได้ =====
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', false);
select pg_temp.fails($q$select public.gb_sheet(p_classroom => current_setting('t.room')::uuid)$q$, 'ไม่พบห้องเรียน', 'ครูอื่นเปิดสมุดคะแนน → ปฏิเสธ');
select pg_temp.ok(not exists (select 1 from public.gb_attempts), 'ครูอื่นอ่านคะแนนรายชุดไม่ได้ (RLS)');
select pg_temp.fails($q$select public.gb_override_set(p_column => (select max(id) from gb_columns), p_seat => 1, p_score => 1, p_reason => 'pass')$q$,
  'ไม่พบ', 'ครูอื่นปรับคะแนน → ปฏิเสธ');
reset role;

\echo 'test_phase9b_web: ALL PASSED'
