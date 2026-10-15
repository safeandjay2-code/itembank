-- ทดสอบ One Stop เฟส 2: หน้าตั้งค่าห้องเรียกฐานข้อมูล "แบบเดียวกับที่เว็บส่งจริง" (web/src/data/supabaseRepo.ts)
--   เรียกฟังก์ชันด้วยชื่อพารามิเตอร์ (เหมือน PostgREST rpc) ในสิทธิ์ authenticated + อ่านตาราง gb_* ผ่าน RLS
--   ถ้าใครเปลี่ยนชื่อพารามิเตอร์/รูป JSON ในฝั่งใดฝั่งหนึ่ง ทดสอบนี้จะพัง
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'PASS: %', msg;
end $$;

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'web-teacher@test'),
  ('00000000-0000-0000-0000-0000000000b2', 'web-other@test')
on conflict (id) do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);

-- createClassroom: rpc('gb_classroom_create', { p: {...} }) — final_max null = ค่าเริ่มต้น 30
select set_config('t.room', public.gb_classroom_create(p => jsonb_build_object(
  'grade_id', 'P5', 'academic_year', 2569, 'term', 1, 'name', 'ป.5/1', 'student_count', 30, 'final_max', null, 'settings', '{}'::jsonb,
  'indicators', jsonb_build_array(
    jsonb_build_object('indicator_id', 'MATH-2560-P5-03', 'max_score', 9),
    jsonb_build_object('indicator_id', 'MATH-2560-P5-01', 'max_score', null))))::text, false);

-- listClassrooms: rpc('gb_classroom_list') — คีย์ที่ toClassroomSummary ใช้
select pg_temp.ok((select x ?& array['id','name','grade_id','academic_year','term','student_count','status','created_at','closed_at','column_count','exam_count']
                   and (x->>'column_count')::int = 2 and (x->>'exam_count')::int = 0
                   from jsonb_array_elements(public.gb_classroom_list()) x where x->>'id' = current_setting('t.room')),
  'gb_classroom_list คืนคีย์ครบตามที่เว็บอ่าน');

-- getClassroom: select gb_classrooms / gb_columns ตรงผ่าน RLS
select pg_temp.ok((select count(*) = 1 and bool_and(settings = '{}'::jsonb and subject_id = 'MATH') from public.gb_classrooms where id = current_setting('t.room')::uuid),
  'อ่านห้องของตัวเองผ่าน RLS ได้');
select pg_temp.ok((select string_agg(kind || ':' || coalesce(indicator_id, '-') || ':' || coalesce(max_score::text, 'null'), ',' order by kind <> 'final', sort)
                   from public.gb_columns where classroom_id = current_setting('t.room')::uuid)
                  = 'final:-:30.00,indicator:MATH-2560-P5-03:9.00,indicator:MATH-2560-P5-01:null',
  'ช่องคะแนน: ปลายภาคค่าเริ่มต้น 30 + ตัวชี้วัดตามลำดับ (ว่าง = ยังไม่ตั้ง)');

-- addColumn: rpc('gb_column_add', { p_classroom, p_kind, p_indicator, p_label, p_max })
select set_config('t.c_other', public.gb_column_add(p_classroom => current_setting('t.room')::uuid, p_kind => 'other',
  p_indicator => null, p_label => 'ส่งงาน', p_max => 5)::text, false);
select set_config('t.c_p4', public.gb_column_add(p_classroom => current_setting('t.room')::uuid, p_kind => 'indicator',
  p_indicator => 'MATH-2560-P4-01', p_label => null, p_max => null)::text, false);
select pg_temp.ok((select count(*) from public.gb_columns where classroom_id = current_setting('t.room')::uuid) = 5, 'gb_column_add ด้วยชื่อพารามิเตอร์ของเว็บ');

-- updateColumn: rpc('gb_column_update', { p_column, p_max, p_label, p_clear_max: maxScore === null })
select public.gb_column_update(p_column => current_setting('t.c_p4')::bigint, p_max => 7.5, p_label => null, p_clear_max => false);
select public.gb_column_update(p_column => current_setting('t.c_other')::bigint, p_max => null, p_label => 'ส่งงานตรงเวลา', p_clear_max => true);
select pg_temp.ok((select max_score from public.gb_columns where id = current_setting('t.c_p4')::bigint) = 7.5
                  and (select max_score is null and label = 'ส่งงานตรงเวลา' from public.gb_columns where id = current_setting('t.c_other')::bigint),
  'gb_column_update: ตั้งคะแนน / ล้างเป็นยังไม่ตั้ง + เปลี่ยนชื่อช่องอื่น');

-- reorderColumns: rpc('gb_column_reorder', { p_classroom, p_ids }) — JSON array → bigint[]
select public.gb_column_reorder(p_classroom => current_setting('t.room')::uuid,
  p_ids => (select array_agg(id order by case when id = current_setting('t.c_p4')::bigint then 0 else 1 end, sort, id)
            from public.gb_columns where classroom_id = current_setting('t.room')::uuid and kind <> 'final'));
select pg_temp.ok((select indicator_id from public.gb_columns where classroom_id = current_setting('t.room')::uuid and kind <> 'final' order by sort limit 1) = 'MATH-2560-P4-01',
  'gb_column_reorder: ช่องที่ลากขึ้นบนสุดอยู่ลำดับ 1');

-- updateClassroom: rpc('gb_classroom_update', { p_classroom, p: { name, student_count, settings } }) — settings null = กลับค่าเริ่มต้น
select public.gb_classroom_update(p_classroom => current_setting('t.room')::uuid, p => '{"name": "ป.5/1 เช้า", "student_count": 28}'::jsonb);
select public.gb_classroom_update(p_classroom => current_setting('t.room')::uuid, p => '{"settings": {"rounding": "1dp", "absent_policy": "skip"}}'::jsonb);
select public.gb_classroom_update(p_classroom => current_setting('t.room')::uuid, p => '{"settings": {"rounding": null}}'::jsonb);
select pg_temp.ok((select name = 'ป.5/1 เช้า' and student_count = 28 and settings = '{"absent_policy": "skip"}'::jsonb
                   from public.gb_classrooms where id = current_setting('t.room')::uuid),
  'gb_classroom_update: ชื่อ/จำนวนนักเรียน/ตั้งค่า (null = กลับค่าเริ่มต้น)');

-- deleteColumn: rpc('gb_column_delete', { p_column })
select public.gb_column_delete(p_column => current_setting('t.c_other')::bigint);
select pg_temp.ok(not exists (select 1 from public.gb_columns where id = current_setting('t.c_other')::bigint), 'gb_column_delete');

-- ครูอื่นมองไม่เห็นห้องนี้ (RLS) และเรียกฟังก์ชันไม่ได้
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select pg_temp.ok((select count(*) from public.gb_classrooms where id = current_setting('t.room')::uuid) = 0
                  and (select count(*) from public.gb_columns where classroom_id = current_setting('t.room')::uuid) = 0
                  and jsonb_array_length(public.gb_classroom_list()) = 0,
  'ครูอื่นไม่เห็นห้อง/ช่องคะแนนของคนอื่น');
do $$ begin
  perform public.gb_classroom_delete(p_classroom => current_setting('t.room')::uuid);
  raise exception 'FAIL: ครูอื่นลบห้องได้';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: ครูอื่นลบห้องไม่ได้ (%)', sqlerrm;
end $$;

-- deleteClassroom: rpc('gb_classroom_delete', { p_classroom })
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select public.gb_classroom_delete(p_classroom => current_setting('t.room')::uuid);
select pg_temp.ok(not exists (select 1 from public.gb_classrooms where id = current_setting('t.room')::uuid), 'gb_classroom_delete');

reset role;
delete from auth.users where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
select 'PASSED: test_phase8b_web';
