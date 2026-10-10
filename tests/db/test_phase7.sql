-- ทดสอบเฟส 7: วงจรปรับความยาก + สุขภาพคลัง (SPEC §11)
--   ก) กรณีขอบที่รู้คำตอบ (fixtures/phase7_calibration.json → known): calib_decide = หน้าเว็บ ทุกกรณี
--   ข) จำลองสอบหลายรอบ (→ simulations): บันทึกสถิติทีละรอบผ่านทริกเกอร์จริง สถานะข้อต้องตรงกับหน้าเว็บทุกขั้น
--   ค) ปิดชุดจริง → ย้ายระดับ/ป้าย r อัตโนมัติ + ช่องขาด · ง) ประวัติ/เวอร์ชันใหม่/ตั้งค่า · จ) สิทธิ์ · ฉ) หน้าสุขภาพคลัง
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
-- ตั้งค่าเกณฑ์ตามกรณีทดสอบ
create or replace function pg_temp.use_settings(s jsonb) returns void language plpgsql as $$
declare k text;
begin
  for k in select jsonb_object_keys(s) loop
    update app_settings set value = s->k where key = k;
  end loop;
end $$;

\set fx `cat tests/db/fixtures/phase7_calibration.json`
create temp table fx as select :'fx'::jsonb as doc;
create temp table default_settings as select key, value from app_settings where key like 'calibration.%';

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@test'),
  ('00000000-0000-0000-0000-00000000000b', 'teacher@test')
on conflict (id) do nothing;
update profiles set role = 'owner' where id = '00000000-0000-0000-0000-00000000000a';
delete from exams; delete from item_stat_rounds; delete from items; delete from calibration_runs;

set client_min_messages = notice;
select pg_temp.ok(exists (select 1 from app_migrations where version = '0010'), 'บันทึก migration 0010');
select pg_temp.ok((select count(*) from app_settings where key in ('calibration.min_n_to_move','calibration.buffer','calibration.r_flag_below',
                   'calibration.r_min_n','calibration.same_grade_only','calibration.recent_days')) = 6, 'ตั้งค่าปรับความยากครบ 6 ค่า');
select pg_temp.ok((select (value #>> '{}')::numeric from app_settings where key = 'calibration.min_n_to_move') = 50
              and (select (value #>> '{}')::numeric from app_settings where key = 'calibration.buffer') = 0.05
              and (select (value #>> '{}')::numeric from app_settings where key = 'calibration.r_flag_below') = 0.2
              and (select (value #>> '{}')::numeric from app_settings where key = 'calibration.r_min_n') = 50,
                  'ค่าเริ่มต้นตาม SPEC §11: n ≥ 50, กันชน 0.05, r < 0.20, ตัดสิน r เมื่อ n ≥ 50');

-- ===== ก) กรณีขอบที่รู้คำตอบ =====
create temp table known_cmp(name text, exp jsonb, got jsonb);
do $$
declare c jsonb;
begin
  for c in select jsonb_array_elements(doc->'known') from fx loop
    perform pg_temp.use_settings(c->'settings');
    insert into known_cmp values (c->>'name', c->'expected',
      public.calib_decide((c->>'current')::smallint, (c->>'n')::int, (c->>'n_correct')::int, (c->>'n_r')::int, (c->>'r_sum_milli')::bigint));
  end loop;
end $$;
select pg_temp.ok((select count(*) from known_cmp) = (select jsonb_array_length(doc->'known') from fx) and (select count(*) from known_cmp) >= 30,
                  'กรณีขอบที่รู้คำตอบ ' || (select count(*) from known_cmp) || ' กรณี');
select pg_temp.ok((select count(*) from known_cmp where got is distinct from exp) = 0,
                  'ฐานข้อมูลตัดสิน (ระดับปลายทาง ทิศ ป้าย r) ตรงกับหน้าเว็บทุกกรณี' ||
                  coalesce(' — ไม่ตรง: ' || (select string_agg(name || ' ' || got::text, '; ') from known_cmp where got is distinct from exp), ''));
select pg_temp.ok((select got->>'target' is null from known_cmp where name like 'ง่าย p 0.75 พอดี%')
              and (select (got->>'target')::int = 2 from known_cmp where name like 'ง่าย p 0.74%'),
                  'ช่วงกันชน: ข้อง่ายย้ายลงเมื่อ p < 0.75 ไม่ใช่ทันทีที่ < 0.80');
select pg_temp.use_settings(jsonb_object_agg(key, value)) from default_settings;

-- ===== ข) จำลองสอบหลายรอบผ่านทริกเกอร์จริง =====
create temp table sim_cmp(sim text, round int, exp jsonb, got jsonb);
do $$
declare
  s jsonb; r jsonb; k int; v_ind text; v_id uuid; v_ver int; v_code int := 700000;
begin
  for s in select jsonb_array_elements(doc->'simulations') from fx loop
    perform pg_temp.use_settings(s->'settings');
    v_id := (s->>'item_id')::uuid; v_code := v_code + 1; v_ver := 1;
    select id into v_ind from indicators where grade_id = s->>'grade_id' and kind = 'terminal' order by sort limit 1;
    insert into items(id, item_code, owner_id, subject_id, indicator_id, cognitive_level, est_difficulty, current_difficulty, status)
    values (v_id, 'M-' || v_code, '00000000-0000-0000-0000-00000000000a', 'MATH', v_ind, 1, (s->>'start')::int, (s->>'start')::int, 'active');
    insert into item_versions(item_id, version, content, answer, qa)
    values (v_id, 1, '{"stem":"จำลอง","options":["ก","ข","ค","ง"],"figure":null,"explanation":"","distractor_rationale":[null,null,null,null]}',
            '{"choice":1}', '{"passed":true,"errors":[],"warnings":[]}');
    k := 0;
    for r in select jsonb_array_elements(s->'rounds') loop
      k := k + 1;
      if (r->>'bump')::boolean then
        v_ver := v_ver + 1;
        insert into item_versions(item_id, version, content, answer, qa)
        values (v_id, v_ver, '{"stem":"จำลอง (แก้)","options":["ก","ข","ค","ง"],"figure":null,"explanation":"","distractor_rationale":[null,null,null,null]}',
                '{"choice":1}', '{"passed":true,"errors":[],"warnings":[]}');
        update items set current_version = v_ver where id = v_id;
      end if;
      insert into item_stat_rounds(item_id, version, grade_id, source_exam_id, n, n_correct, r, option_counts)
      values (v_id, (r->>'version')::int, r->>'grade_id', gen_random_uuid(), (r->>'n')::int, (r->>'n_correct')::int, (r->>'r')::numeric, '{}');
      insert into sim_cmp select s->>'name', k, (r->'expected') - 'moved',
             jsonb_build_object('difficulty', i.current_difficulty, 'flag', i.quality_flag, 'status', i.status) from items i where i.id = v_id;
    end loop;
  end loop;
end $$;
select pg_temp.use_settings(jsonb_object_agg(key, value)) from default_settings;

select pg_temp.ok((select count(*) from sim_cmp) = (select sum(jsonb_array_length(s->'rounds')) from fx, jsonb_array_elements(doc->'simulations') s)
              and (select count(distinct sim) from sim_cmp) >= 12,
                  'จำลองสอบ ' || (select count(distinct sim) from sim_cmp) || ' ข้อ รวม ' || (select count(*) from sim_cmp) || ' รอบ');
select pg_temp.ok((select count(*) from sim_cmp where got is distinct from exp) = 0,
                  'ทุกรอบ: ระดับ ป้าย r สถานะ ของข้อในฐานข้อมูล = ที่หน้าเว็บคำนวณ' ||
                  coalesce(' — ไม่ตรง: ' || (select string_agg(sim || ' รอบ ' || round || ' ได้ ' || got::text || ' ควร ' || exp::text, '; ') from sim_cmp where got is distinct from exp), ''));
select pg_temp.ok((select count(*) from item_level_moves m where m.item_id::text like '00000000-0000-4000-c700-%')
                  = (select count(*) from fx, jsonb_array_elements(doc->'simulations') s, jsonb_array_elements(s->'rounds') r where (r->'expected'->>'moved')::boolean),
                  'ประวัติการย้าย: บันทึกครบทุกครั้งที่ย้าย (' || (select count(*) from item_level_moves) || ' ครั้ง)');
select pg_temp.ok((select count(*) filter (where direction = 'easier') > 0 and count(*) filter (where direction = 'harder') > 0 from item_level_moves),
                  'ย้ายได้ทั้งขึ้น (ง่ายขึ้น) และลง (ยากขึ้น)');
select pg_temp.ok((select bool_and(m.n >= 50 and m.p is not null and m.moved_at is not null and m.from_difficulty <> m.to_difficulty
                          and m.direction = case when m.to_difficulty < m.from_difficulty then 'easier' else 'harder' end
                          and m.version <= (select i.current_version from items i where i.id = m.item_id))
                   from item_level_moves m), 'ประวัติการย้ายมี จาก→ไป ทิศ วันที่ p n (n ≥ 50 ทุกครั้ง)');
select pg_temp.ok((select count(*) from item_events e where e.event_type = 'difficulty_changed') = (select count(*) from item_level_moves),
                  'ทุกการย้ายมีบันทึกเหตุการณ์ของข้อด้วย');
select pg_temp.ok((select count(*) from items where quality_flag = 'negative_r' and status = 'needs_fix') >= 1
              and (select count(*) from items where quality_flag = 'low_r' and status in ('reviewed', 'active')) >= 1,
                  'r ติดลบ → ต้องแก้ด่วน + สถานะต้องแก้ · r ต่ำ → ติดป้ายแต่ยังพร้อมใช้');
select pg_temp.ok((select count(*) from items i where i.quality_flag is not null and i.quality_detail is null) = 0
              and (select count(*) from item_events where event_type = 'quality_flag_changed') >= 3,
                  'ป้ายคุณภาพมีรายละเอียด (r, n) และบันทึกเหตุการณ์');
select pg_temp.ok((select calibration_runs.source = 'exam' and source_exam_id is not null from calibration_runs order by id desc limit 1)
              and (select count(*) from calibration_runs) = (select count(*) from sim_cmp),
                  'บันทึกการปรับ 1 ครั้งต่อการบันทึกสถิติจากชุดข้อสอบ 1 ชุด');

-- ข้อที่หยุดสุ่ม (r ติดลบ) ไม่อยู่ในคลังพร้อมใช้ · ข้อ r ต่ำยังอยู่
select pg_temp.ok((select count(*) from jsonb_array_elements(public.assembly_pool('MATH')) p
                   join items i on i.id = (p->>'id')::uuid where i.quality_flag = 'negative_r') = 0
              and (select count(*) from jsonb_array_elements(public.assembly_pool('MATH')) p
                   join items i on i.id = (p->>'id')::uuid where i.quality_flag = 'low_r') >= 1,
                  'ประกอบชุด: ข้อ r ติดลบไม่ถูกสุ่ม · ข้อ r ต่ำยังสุ่มได้');

-- นำเข้าไฟล์สำรอง (สถิติไม่มี source_exam_id) ไม่ทำให้ย้ายระดับ
do $$
declare v_runs int := (select count(*) from calibration_runs);
begin
  insert into item_stat_rounds(item_id, version, grade_id, n, n_correct, r)
  select id, current_version, 'P4', 100, 100, 0.5 from items where item_code = 'M-700005';
  if (select count(*) from calibration_runs) <> v_runs then raise exception 'FAIL: สถิติที่ไม่ได้มาจากชุดข้อสอบทำให้ปรับความยาก'; end if;
  delete from item_stat_rounds where source_exam_id is null;
end $$;
select pg_temp.ok(true, 'สถิติจากการนำเข้า (ไม่ใช่ชุดข้อสอบ) ไม่ทำให้ย้ายระดับทันที');

-- ===== ง) เปลี่ยนเกณฑ์แล้วสั่งปรับทั้งคลัง · เวอร์ชันใหม่ล้างป้าย =====
create temp table manual_item as select id from items where item_code = 'M-700005';  -- seed 15 ใกล้เส้น 0.50 อยู่ปานกลาง
select pg_temp.ok((select current_difficulty from items where id = (select id from manual_item)) = 2, 'ข้อใกล้เส้น 0.50 อยู่ระดับปานกลาง (กันชนกันไว้)');
update app_settings set value = '0.12'::jsonb where key = 'calibration.buffer';
select pg_temp.ok((public.calib_run(array(select id from manual_item))->>'items_checked')::int = 1, 'สั่งปรับเฉพาะข้อที่เลือกได้');
select pg_temp.ok((select current_difficulty from items where id = (select id from manual_item)) = 2, 'กันชนกว้างขึ้น → ยังไม่ย้าย');
update app_settings set value = '0'::jsonb where key = 'calibration.buffer';
create temp table run_all as select public.calib_run() as s;
select pg_temp.ok((select (s->>'items_checked')::int from run_all) = (select count(*) from items where status in ('reviewed','active','needs_fix')),
                  'สั่งปรับทั้งคลัง: ตรวจทุกข้อที่พร้อมใช้/ต้องแก้');
select pg_temp.ok((select (s->>'source') = 'manual' from run_all), 'บันทึกว่าเป็นการสั่งปรับเอง');
select pg_temp.use_settings(jsonb_object_agg(key, value)) from default_settings;
create temp table run_again as select public.calib_run() as s;
select pg_temp.ok((select jsonb_array_length(s->'moved') from run_again) <= (select jsonb_array_length(s->'moved') from run_all)
              and (select jsonb_array_length(s->'flagged') from run_again) = 0,
                  'สั่งปรับซ้ำด้วยข้อมูลเดิม: ไม่ติดป้ายซ้ำ');
create temp table run_idem as select public.calib_run() as s;
select pg_temp.ok((select jsonb_array_length(s->'moved') = 0 and jsonb_array_length(s->'flagged') = 0 and jsonb_array_length(s->'unflagged') = 0 from run_idem),
                  'สั่งปรับซ้ำอีกครั้ง: ไม่มีอะไรเปลี่ยน (ผลคงที่)');

create temp table flagged_item as select id, current_version from items where quality_flag = 'low_r' and status in ('reviewed','active') order by item_code limit 1;
insert into item_versions(item_id, version, content, answer, qa)
select id, current_version + 1, '{"stem":"แก้แล้ว","options":["ก","ข","ค","ง"],"figure":null,"explanation":"","distractor_rationale":[null,null,null,null]}',
       '{"choice":1}', '{"passed":true,"errors":[],"warnings":[]}' from flagged_item;
update items set current_version = current_version + 1 where id = (select id from flagged_item);
select pg_temp.ok((select quality_flag is null and quality_detail is null from items where id = (select id from flagged_item))
              and exists (select 1 from item_events where item_id = (select id from flagged_item) and event_type = 'quality_flag_changed' and payload->>'reason' = 'new_version'),
                  'ขึ้นเวอร์ชันใหม่ → ป้าย r ของเวอร์ชันเก่าหายพร้อมบันทึก');
select pg_temp.ok((select (stats->>'n')::int = 0 and stats->>'version' = (select (current_version + 1)::text from flagged_item)
                   from (select public.calib_item_info((select id from flagged_item)) as x) y, lateral (select x->'stats' as stats) z),
                  'สถิติที่ใช้ปรับความยากเริ่มนับใหม่ที่เวอร์ชันใหม่');
select pg_temp.ok((select jsonb_array_length(x->'rounds') > 0 and jsonb_array_length(x->'moves') >= 0 and x->'decision' ? 'flag'
                   from (select public.calib_item_info((select id from flagged_item)) as x) y), 'ข้อมูลปรับความยากรายข้อ: รอบสอบทั้งหมด ประวัติการย้าย ผลตัดสิน');

-- ===== ค) ปิดชุดจริง → ปรับความยากอัตโนมัติ =====
delete from exams; delete from item_stat_rounds; delete from items; delete from calibration_runs;
-- 3 ข้อ ตัวชี้วัด ป.4 ข้อแรก ระดับปานกลาง มีสถิติเดิม 40 คน (นำเข้า)
insert into items(id, item_code, owner_id, subject_id, indicator_id, cognitive_level, est_difficulty, current_difficulty, status) values
  ('00000000-0000-4000-c701-000000000001', 'M-710001', '00000000-0000-0000-0000-00000000000a', 'MATH', 'MATH-2560-P4-01', 1, 2, 2, 'active'),
  ('00000000-0000-4000-c701-000000000002', 'M-710002', '00000000-0000-0000-0000-00000000000a', 'MATH', 'MATH-2560-P4-01', 1, 2, 2, 'active'),
  ('00000000-0000-4000-c701-000000000003', 'M-710003', '00000000-0000-0000-0000-00000000000a', 'MATH', 'MATH-2560-P4-01', 1, 2, 2, 'active');
insert into item_versions(item_id, version, content, answer, qa)
select id, 1, '{"stem":"โจทย์","options":["ก","ข","ค","ง"],"figure":null,"explanation":"","distractor_rationale":[null,null,null,null]}',
       '{"choice":1}', '{"passed":true,"errors":[],"warnings":[]}' from items;
insert into item_stat_rounds(item_id, version, grade_id, n, n_correct, r) values
  ('00000000-0000-4000-c701-000000000001', 1, 'P4', 40, 38, 0.5),
  ('00000000-0000-4000-c701-000000000002', 1, 'P4', 40, 24, -0.5),
  ('00000000-0000-4000-c701-000000000003', 1, 'P4', 40, 20, 0.1);
insert into exams(id, owner_id, title, subject_id, grade_id, item_count, set_count, student_count, status, template_version, opened_at)
values ('00000000-0000-4000-e700-000000000001', '00000000-0000-0000-0000-00000000000a', 'ปิดชุดเฟส 7', 'MATH', 'P4', 3, 1, 30, 'open', 1, now());
insert into exam_items(exam_id, item_id, item_version, base_position, indicator_id, difficulty_at_build)
select '00000000-0000-4000-e700-000000000001', id, 1, row_number() over (order by item_code), indicator_id, 2 from items;
insert into exam_set_items(exam_id, set_no, position, item_id, option_order)
select '00000000-0000-4000-e700-000000000001', 1, row_number() over (order by item_code), id, '{1,2,3,4}' from items;
insert into exam_seats(exam_id, seat_no, set_no) select '00000000-0000-4000-e700-000000000001', k, 1 from generate_series(1, 30) k;
-- ข้อ 1 ทุกคนถูก · ข้อ 2 ถูกเฉพาะเลขที่ 16–30 · ข้อ 3 ถูกเฉพาะเลขที่ 1–15 (คะแนนเท่ากันทุกคน → กลุ่มสูง = เลขที่ 1–8)
insert into responses(exam_id, seat_no, set_no, answers, source)
select '00000000-0000-4000-e700-000000000001', k, 1,
       jsonb_build_array(1, case when k > 15 then 1 else 2 end, case when k <= 15 then 1 else 2 end), 'upload'
from generate_series(1, 30) k;

create temp table e7 as select '00000000-0000-4000-e700-000000000001'::uuid as id;
grant select on e7 to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.fails($$select public.calib_exam_result((select id from e7))$$, 'ไม่พบชุดข้อสอบ', 'ครูคนอื่นดูผลปรับความยากของชุดผู้อื่นไม่ได้');
select pg_temp.fails($$select public.calib_run()$$, 'ไม่มีสิทธิ์', 'ครูทั่วไปสั่งปรับความยากทั้งคลังไม่ได้');
select pg_temp.fails($$select public.bank_health('MATH')$$, 'ไม่มีสิทธิ์', 'ครูทั่วไปดูหน้าสุขภาพคลังไม่ได้');
select pg_temp.fails($$select public.calib_item_info('00000000-0000-4000-c701-000000000001')$$, 'ไม่มีสิทธิ์', 'ครูทั่วไปดูสถิติรายข้อของคลังไม่ได้');
select pg_temp.fails($$select public.calib_run_internal(null, 'manual', null)$$, 'permission denied', 'ผู้ใช้เรียกฟังก์ชันปรับภายในโดยตรงไม่ได้');
select pg_temp.fails($$select public.calib_apply_item('00000000-0000-4000-c701-000000000001', null)$$, 'permission denied', 'ผู้ใช้เรียกฟังก์ชันปรับรายข้อโดยตรงไม่ได้');
select pg_temp.ok((select count(*) from item_level_moves) = 0 and (select count(*) from calibration_runs) = 0, 'ครูทั่วไปไม่เห็นประวัติการย้าย/บันทึกการปรับ (RLS)');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
create temp table closed7 as select public.exam_close((select id from e7)) as s;
create temp table res7 as select public.calib_exam_result((select id from e7)) as s;
reset role;
set role anon;
select pg_temp.fails($$select public.calib_run()$$, 'permission denied', 'ผู้ไม่ล็อกอินสั่งปรับไม่ได้');
select pg_temp.fails($$select public.bank_health('MATH')$$, 'permission denied', 'ผู้ไม่ล็อกอินดูสุขภาพคลังไม่ได้');
reset role;

select pg_temp.ok((select array_agg(s.n || ':' || s.n_correct || ':' || s.r order by i.item_code) from item_stat_rounds s join items i on i.id = s.item_id
                   where s.source_exam_id = (select id from e7)) = array['30:30:0.000', '30:15:-1.000', '30:15:1.000'],
                  'ปิดชุด: สถิติรอบใหม่ (p, r 27%) ตรงกับที่ออกแบบ');
select pg_temp.ok((select current_difficulty from items where item_code = 'M-710001') = 1,
                  'ข้อ 1: p สะสม 68/70 = 0.97 (n 70) → ย้ายจากปานกลางเป็นง่ายทันทีที่ปิดชุด');
select pg_temp.ok((select quality_flag = 'negative_r' and status = 'needs_fix' and current_difficulty = 2 from items where item_code = 'M-710002'),
                  'ข้อ 2: r สะสม (−0.5×40 −1×30)/70 = −0.71 → ต้องแก้ด่วน + หยุดสุ่ม (p 0.56 อยู่ปานกลางเหมือนเดิม)');
select pg_temp.ok((select quality_flag is null and status = 'active' and current_difficulty = 2 from items where item_code = 'M-710003'),
                  'ข้อ 3: r สะสม 0.49 p 0.50 → ไม่เปลี่ยน');
select pg_temp.ok((select (m.p, m.n, m.from_difficulty, m.to_difficulty, m.direction) = (0.9714, 70, 2::smallint, 1::smallint, 'easier')
                   from item_level_moves m join items i on i.id = m.item_id where i.item_code = 'M-710001'),
                  'ประวัติการย้าย: ปานกลาง→ง่าย p 0.9714 n 70');
select pg_temp.ok((select jsonb_array_length(s->'moved') = 1 and jsonb_array_length(s->'flagged') = 1 and (s->>'stopped')::int = 1
                          and s->>'exam_id' = (select id::text from e7) and s->>'source' = 'exam' from res7),
                  'ผลการปรับจากการปิดชุด: ย้าย 1 ข้อ ติดป้าย 1 ข้อ หยุดสุ่ม 1 ข้อ');
select pg_temp.ok((select s->'shortfalls' @> '[{"indicator_id":"MATH-2560-P4-01","difficulty_id":2,"target":20}]' from res7),
                  'แจ้งเตือนช่องขาด: ตัวชี้วัด ป.4/1 ระดับปานกลาง ต่ำกว่าเป้าเพราะมีข้อย้ายออก');
select pg_temp.ok((select (s->'shortfalls'->0->>'ready')::int from res7) = (select ready_count from bank_coverage where indicator_id = 'MATH-2560-P4-01' and difficulty_id = 2),
                  'ช่องขาดบอกจำนวนข้อพร้อมใช้ที่เหลือจริง');
select pg_temp.ok((select count(*) from responses where exam_id = (select id from e7)) = 0, 'ปิดชุดยังลบข้อมูลรายเลขที่ทั้งหมดเหมือนเดิม');

-- ===== ฉ) หน้าสรุปสุขภาพคลัง =====
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
create temp table h as select public.bank_health('MATH') as h;
reset role;
select pg_temp.ok((select h->'coverage'->>'cells' = '132' and (h->'coverage'->>'target_total')::int = 132 * 20 from h), 'สุขภาพคลัง: ผังความครบ 33 ตัวชี้วัด × 4 ระดับ = 132 ช่อง เป้า 2,640 ข้อ');
select pg_temp.ok((select jsonb_array_length(h->'shortfalls') = 132 from h), 'สุขภาพคลัง: ช่องที่ต่ำกว่าเป้าครบทุกช่อง (คลังยังเล็ก)');
select pg_temp.ok((select x->>'moved_out' = '1' from h, jsonb_array_elements(h->'shortfalls') x
                   where x->>'indicator_id' = 'MATH-2560-P4-01' and x->>'difficulty_id' = '2')
                  and (select x->>'need' from h, jsonb_array_elements(h->'shortfalls') x where x->>'indicator_id' = 'MATH-2560-P4-01' and x->>'difficulty_id' = '2') = '19',
                  'สุขภาพคลัง: ช่องที่มีข้อย้ายออกล่าสุดถูกระบุ พร้อมจำนวนที่ต้องเติม (19)');
select pg_temp.ok((select jsonb_array_length(h->'flagged') = 1 and h->'flagged'->0->>'flag' = 'negative_r' and h->'flagged'->0->>'item_code' = 'M-710002' from h),
                  'สุขภาพคลัง: รายการข้อต้องแก้ (ติดลบขึ้นก่อน)');
select pg_temp.ok((select jsonb_array_length(h->'recent_moves') = 1 and h->'recent_moves'->0->>'item_code' = 'M-710001' and h->'move_totals'->>'easier' = '1' from h),
                  'สุขภาพคลัง: การย้ายระดับล่าสุด');
select pg_temp.ok((select h->'n_buckets' = '{"none":0,"collecting":0,"calibrated":3}' and h->'status_counts' = '{"active":2,"needs_fix":1}' from h),
                  'สุขภาพคลัง: จำนวนข้อตามสถานะและความครบของสถิติ');
select pg_temp.ok((select jsonb_array_length(h->'runs') >= 1 and h->'runs'->0->>'source' = 'exam' and h->'settings'->>'same_grade_only' = 'true' from h),
                  'สุขภาพคลัง: บันทึกการปรับล่าสุดและเกณฑ์ที่ใช้');
select pg_temp.ok((select jsonb_array_length(h->'level_mix') = 4 from h), 'สุขภาพคลัง: เทียบระดับคาดการณ์กับระดับปัจจุบัน');

-- มุมมองรายการข้อแสดงป้ายและสถิติปรับความยาก
select pg_temp.ok((select quality_flag = 'negative_r' and calib_n = 70 and calib_n_r = 70 from bank_item_list where item_code = 'M-710002'),
                  'รายการข้อแสดงป้ายคุณภาพและ n ที่ใช้ปรับความยาก');

-- ลบข้อ → ประวัติลบตาม · ลบชุด → บันทึกการปรับยังอยู่
delete from exams;
select pg_temp.ok((select count(*) from calibration_runs where source_exam_id = '00000000-0000-4000-e700-000000000001') = 1, 'ลบชุดที่ปิดแล้ว บันทึกการปรับยังอยู่');
delete from item_stat_rounds; delete from items;
select pg_temp.ok((select count(*) from item_level_moves) = 0, 'ลบข้อแล้วประวัติการย้ายถูกลบตาม');
delete from calibration_runs;
select 'PASSED phase 7';
