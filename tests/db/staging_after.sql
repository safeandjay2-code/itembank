-- One Stop เฟส 6: ตรวจหลังติดตั้ง migration ใหม่ทับฐานสภาพระบบจริง (ต่อจาก staging_before.sql)
--   ก) ข้อมูลที่ครูใช้อยู่ไม่เปลี่ยนและยังใช้ต่อได้เหมือนเดิม
--   ข) ทดสอบรวมทั้งเส้นทาง One Stop บนฐานเดียวกัน: ตั้งห้อง → ตั้งคะแนน → ชุดผูกห้อง → ตรวจ → สอบซ่อม → ปรับให้ผ่าน
--      → ปลายภาค → สมุดคะแนน (ค่าคำนวณมือ) → ปิดเทอม → ชุดฝึกเดิมยังไม่ถูกแตะ
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

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

-- ===================== ก) ข้อมูลเดิมไม่เปลี่ยน =====================
select pg_temp.ok((select migrations from stg.counts) = '0001,0002,0003,0004,0005,0006,0007,0008,0009,0010,S001'
                  and exists (select 1 from app_migrations where version = '0011') and exists (select 1 from app_migrations where version = '0012'),
  'ก่อนติดตั้ง = ระบบจริง (0001–0010) · หลังติดตั้งมี 0011, 0012');
select pg_temp.ok((select items from stg.counts) = (select count(*) from items)
                  and (select stat_rounds from stg.counts) = (select count(*) from item_stat_rounds)
                  and (select exams from stg.counts) = (select count(*) from exams),
  'จำนวนข้อสอบในคลัง / สถิติข้อสอบ / ชุดข้อสอบ เท่าเดิม');
select pg_temp.ok((select bool_and(e.purpose = 'practice' and e.classroom_id is null and e.retake_of is null) from exams e),
  'ชุดเดิมทุกชุดกลายเป็น "ชุดฝึก" ไม่ผูกห้อง');
select pg_temp.ok((select bool_and(e.status = b.status and e.expires_at is not distinct from b.expires_at
                                   and e.closed_summary is not distinct from b.closed_summary
                                   and (select count(*) from responses r where r.exam_id = e.id) = b.responses
                                   and (select coalesce(jsonb_agg(r.answers order by r.seat_no), '[]'::jsonb) from responses r where r.exam_id = e.id) = b.answers
                                   and (select count(*) from item_stat_rounds s where s.source_exam_id = e.id) = b.stat_rounds)
                   from exams e join stg.before b on b.id = e.id),
  'ทุกชุดเดิม: สถานะ / วันหมดอายุ / ผลสรุปตอนปิด / คำตอบที่ตรวจแล้ว / สถิติ เหมือนก่อนติดตั้งทุกตัว');
select pg_temp.ok((select (select status from exams where id = a.id) = 'open' and (select expires_at from exams where id = a.id) is not null
                   from stg.ids a where name = 'A'),
  'ชุด A ที่เปิดสอบอยู่ยังมีวันหมดอายุ 60 วันเหมือนเดิม');
select pg_temp.ok(not exists (select 1 from gb_attempts) and not exists (select 1 from gb_classrooms),
  'ติดตั้งแล้วไม่มีสมุดคะแนนเกิดขึ้นเองจากชุดเดิม');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
select pg_temp.ok((select bool_and(public.exam_get(b.id) = b.exam_doc) from stg.before b),
  'เปิดดูชุดเดิม (exam_get) ได้ผลเหมือนก่อนติดตั้งทุกชุด');
-- ชุด A ใช้ต่อได้: ตรวจเพิ่ม · ตรวจแผ่นเดิมซ้ำ · ปิดชุด
select stg.scan((select id from stg.ids where name = 'A'), 3, true);
select stg.scan((select id from stg.ids where name = 'A'), 2, true);
select pg_temp.ok((select count(*) from responses where exam_id = (select id from stg.ids where name = 'A')) = 3
                  and not exists (select 1 from gb_attempts),
  'ชุด A ตรวจต่อได้ (3 คน) · ชุดฝึกไม่ส่งคะแนนเข้าสมุด');
select pg_temp.fails($q$select stg.scan((select id from stg.ids where name = 'B'), 4, true)$q$, 'ปิดแล้ว', 'ชุด B ที่ปิดแล้วยังตรวจเพิ่มไม่ได้เหมือนเดิม');
create temp table fa as select public.exam_close(p_exam => (select id from stg.ids where name = 'A')) as j;
select pg_temp.ok((select status = 'closed' from exams where id = (select id from stg.ids where name = 'A'))
                  and not exists (select 1 from responses where exam_id = (select id from stg.ids where name = 'A'))
                  and (select (j->>'responses_deleted')::int = 3 from fa),
  'ปิดชุด A ได้ · คำตอบถูกลบตามกติกาเดิม (ชุดฝึก)');
select public.exam_delete(p_exam => (select id from stg.ids where name = 'C'));
select pg_temp.ok(not exists (select 1 from exams where id = (select id from stg.ids where name = 'C')), 'ลบชุด C ที่ยังไม่สอบได้เหมือนเดิม');
select pg_temp.ok(public.gb_classroom_list() = '[]'::jsonb,
  'ครูเปิดหน้า "ห้องเรียน" ครั้งแรก: ยังไม่มีห้อง');

-- ===================== ข) ทดสอบรวมทั้งเส้นทาง =====================
-- ห้อง ป.5/2 นักเรียน 9 คน · ตัวชี้วัด ค 01, 02, 04 (ตามชุดเก็บคะแนน แผน 1) เต็มช่องละ 10 · ปลายภาค 30
select set_config('t.room', public.gb_classroom_create(p => jsonb_build_object(
  'grade_id', 'P5', 'academic_year', 2569, 'term', 2, 'name', 'ป.5/2', 'student_count', 9,
  'indicators', jsonb_build_array(
     jsonb_build_object('indicator_id', 'MATH-2560-P5-04', 'max_score', 10),
     jsonb_build_object('indicator_id', 'MATH-2560-P5-01', 'max_score', 10),
     jsonb_build_object('indicator_id', 'MATH-2560-P5-02', 'max_score', 10))))::text, false);
-- เรียงตามแผนการสอน 01 → 02 → 04
select public.gb_column_reorder(p_classroom => current_setting('t.room')::uuid, p_ids => (
  select array_agg(id order by indicator_id) from gb_columns where classroom_id = current_setting('t.room')::uuid and kind = 'indicator'));
create temp table col as
select id, kind, indicator_id from gb_columns where classroom_id = current_setting('t.room')::uuid;
grant select on col to authenticated;
select pg_temp.ok((select jsonb_agg(c->>'indicator_id' order by o) from jsonb_array_elements(public.gb_sheet(p_classroom => current_setting('t.room')::uuid)->'columns') with ordinality t(c, o))
                  = '["MATH-2560-P5-01", "MATH-2560-P5-02", "MATH-2560-P5-04", null]'::jsonb,
  'ตั้งห้อง: ช่อง 01 → 02 → 04 → ปลายภาค (ลากเรียงแล้ว)');
select pg_temp.ok((select (x->'totals'->>'collect_max')::numeric = 30 and (x->'totals'->>'final_max')::numeric = 30 and (x->'totals'->>'max')::numeric = 60
                   from (select public.gb_sheet(p_classroom => current_setting('t.room')::uuid) x) s),
  'คะแนนเต็ม: เก็บ 30 + ปลายภาค 30 = 60');

-- ชุดเก็บคะแนน e1 (แผน 1, 9 คน) · ปลายภาค f1 (แผน 1) · ชุดฝึก p1 ผูกห้องไม่ได้นับ
select set_config('t.e1', public.exam_create_linked(p => (select plan from stg.pl where k = 1)
  || jsonb_build_object('classroom_id', current_setting('t.room'), 'purpose', 'collect', 'retake_of', null))::text, false);
select set_config('t.f1', public.exam_create_linked(p => (select plan from stg.pl where k = 1)
  || jsonb_build_object('classroom_id', current_setting('t.room'), 'purpose', 'final', 'retake_of', null))::text, false);
select set_config('t.p1', public.exam_create_linked(p => (select plan from stg.pl where k = 0)
  || jsonb_build_object('classroom_id', null, 'purpose', 'practice', 'retake_of', null))::text, false);
select pg_temp.ok((select expires_at is null from exams where id = current_setting('t.e1')::uuid),
  'ชุดผูกห้องไม่มีวันหมดอายุ');

-- ตรวจ e1: เลขที่ 1, 3 ถูกหมด · เลขที่ 2 ผิดหมด · 4–9 ขาด
select stg.scan(current_setting('t.e1')::uuid, 1, true);
select stg.scan(current_setting('t.e1')::uuid, 2, false);
select stg.scan(current_setting('t.e1')::uuid, 3, true);
select stg.scan(current_setting('t.p1')::uuid, 1, false);
-- สอบซ่อม r1 (แผน 0 = ตัวชี้วัด 01, 02, 03, 04 · 5 คน) เลขที่ 2 ถูกหมด
select set_config('t.r1', public.exam_create_linked(p => (select plan from stg.pl where k = 0)
  || jsonb_build_object('classroom_id', current_setting('t.room'), 'purpose', 'collect', 'retake_of', current_setting('t.e1')))::text, false);
select stg.scan(current_setting('t.r1')::uuid, 2, true);
-- ปรับให้ผ่าน: เลขที่ 4 ช่อง 01 = 5 (เต็ม 10 × 50%)
select public.gb_override_set(p_column => (select id from col where indicator_id = 'MATH-2560-P5-01'), p_seat => 4, p_score => 5, p_reason => 'pass');
-- ปลายภาค f1: เลขที่ 1 ถูกหมด · เลขที่ 2 ผิดหมด · เลขที่ 3 ขาด
select stg.scan(current_setting('t.f1')::uuid, 1, true);
select stg.scan(current_setting('t.f1')::uuid, 2, false);
-- ปิดชุด e1 กลางเทอม: คะแนนต้องอยู่ต่อ
select public.exam_close(p_exam => current_setting('t.e1')::uuid);

create temp table sh as select public.gb_sheet(p_classroom => current_setting('t.room')::uuid) as j;
grant select on sh to authenticated;
create temp view cell as
select (r->>'seat_no')::int seat, col.indicator_id, col.kind, (c->>'value')::numeric v, c->>'reason' reason, c->'missing' missing
from sh, jsonb_array_elements(j->'rows') r, jsonb_array_elements(r->'cells') c join col on col.id = (c->>'column_id')::bigint;
-- ค่าที่คำนวณมือ (นับสอบซ่อมครั้งสูงสุด · ขาดสอบ = 0 · ปัดจำนวนเต็ม)
--   เลขที่ 1: 10, 10, 10 | ปลายภาค 30 → 60
--   เลขที่ 2: e1 ผิดหมด แต่สอบซ่อมถูกหมด → 10, 10, 10 | ปลายภาค 0 → 30
--   เลขที่ 3: 10, 10, 10 | ปลายภาคขาด 0 → 30
--   เลขที่ 4: ขาด แต่ปรับช่อง 01 ให้ผ่าน = 5 → 5, 0, 0 | 0 → 5
--   เลขที่ 5–9: 0 ทุกช่อง → 0
create temp table expect(seat int, ind text, v numeric);
insert into expect values
  (1,'MATH-2560-P5-01',10),(1,'MATH-2560-P5-02',10),(1,'MATH-2560-P5-04',10),(1,null,30),
  (2,'MATH-2560-P5-01',10),(2,'MATH-2560-P5-02',10),(2,'MATH-2560-P5-04',10),(2,null,0),
  (3,'MATH-2560-P5-01',10),(3,'MATH-2560-P5-02',10),(3,'MATH-2560-P5-04',10),(3,null,0),
  (4,'MATH-2560-P5-01',5),(4,'MATH-2560-P5-02',0),(4,'MATH-2560-P5-04',0),(4,null,0);
insert into expect select s, i, 0 from generate_series(5, 9) s, unnest(array['MATH-2560-P5-01','MATH-2560-P5-02','MATH-2560-P5-04',null]) i;
grant select on expect to authenticated;
select pg_temp.ok((select count(*) = 36 and bool_and(c.v = e.v) from expect e join cell c on c.seat = e.seat and c.indicator_id is not distinct from e.ind),
  'สมุดคะแนน 9 คน × 4 ช่อง ตรงค่าคำนวณมือทุกช่อง');
select pg_temp.ok((select jsonb_agg((r->>'total')::numeric order by (r->>'seat_no')::int) from sh, jsonb_array_elements(j->'rows') r)
                  = '[60, 30, 30, 5, 0, 0, 0, 0, 0]'::jsonb,
  'คะแนนรวมรายคน 60, 30, 30, 5, 0 …');
select pg_temp.ok((select reason = 'pass' from cell where seat = 4 and indicator_id = 'MATH-2560-P5-01'), 'เลขที่ 4 ช่อง 01 มีป้าย "ปรับผ่าน"');
select pg_temp.ok((select jsonb_array_length(missing) = 1 from cell where seat = 3 and kind = 'final')
                  and (select jsonb_array_length(missing) = 0 from cell where seat = 2 and kind = 'final'),
  'เลขที่ 3 ปลายภาค = ขาดสอบ · เลขที่ 2 สอบแล้วได้ 0 (ไม่ใช่ขาด)');
select pg_temp.ok((select j->'unplanned_indicators' = '["MATH-2560-P5-03"]'::jsonb from sh),
  'ตัวชี้วัด 03 ในชุดสอบซ่อมที่ห้องไม่มีช่อง → แจ้งเตือน "ยังไม่มีช่อง"');
select pg_temp.ok(not exists (select 1 from gb_attempts where exam_id = current_setting('t.p1')::uuid),
  'ชุดฝึกที่ไม่ผูกห้องไม่เข้าสมุด');

-- เปลี่ยนวิธีนับสอบซ่อมเป็น "ล่าสุด" → เลขที่ 2 ยังได้ 10 (ครั้งล่าสุดถูกหมด) · เปลี่ยนเป็น "ครูเลือก" แล้วเลือกครั้งแรก → 0
select public.gb_classroom_update(p_classroom => current_setting('t.room')::uuid, p => '{"settings":{"retake_policy":"manual"}}'::jsonb);
select public.gb_retake_choose(p_root => current_setting('t.e1')::uuid, p_seat => 2, p_chosen => current_setting('t.e1')::uuid);
select pg_temp.ok((select (r->>'total')::numeric = 0 from jsonb_array_elements(public.gb_sheet(p_classroom => current_setting('t.room')::uuid)->'rows') r
                   where (r->>'seat_no')::int = 2),
  'ครูเลือกนับครั้งแรกของเลขที่ 2 → รวม 0');
select public.gb_classroom_update(p_classroom => current_setting('t.room')::uuid, p => '{"settings":{"retake_policy":null}}'::jsonb);

-- ปิดเทอม
create temp table cs as select public.gb_classroom_close(p_classroom => current_setting('t.room')::uuid) as j;
grant select on cs to authenticated;
-- เฉลี่ยรวม = (60 + 30 + 30 + 5) / 9 = 13.89 · ช่อง 01 เฉลี่ย (10+10+10+5)/9 = 3.89
select pg_temp.ok((select (j->>'total_mean')::numeric = 13.89 and (j->>'seat_count')::int = 9 from cs),
  'ปิดเทอม: เฉลี่ยรวม 13.89 (คิดมือ 125 ÷ 9)');
select pg_temp.ok((select (c->>'mean')::numeric = 3.89 and (c->>'min')::numeric = 0 and (c->>'max')::numeric = 10
                   from cs, jsonb_array_elements(j->'columns') c where c->>'indicator_id' = 'MATH-2560-P5-01'),
  'ช่อง 01: เฉลี่ย 3.89 ต่ำสุด 0 สูงสุด 10');
select pg_temp.ok(not exists (select 1 from gb_attempts) and not exists (select 1 from gb_overrides) and not exists (select 1 from gb_retake_choices)
                  and not exists (select 1 from responses where exam_id in (current_setting('t.e1')::uuid, current_setting('t.r1')::uuid, current_setting('t.f1')::uuid)),
  'หลังปิดเทอมไม่เหลือข้อมูลรายเลขที่ของห้องนี้');
select pg_temp.ok((select status = 'open' and classroom_id is null from exams where id = current_setting('t.p1')::uuid)
                  and (select count(*) = 1 from responses where exam_id = current_setting('t.p1')::uuid),
  'ชุดฝึกของครูที่ไม่ผูกห้องไม่ถูกแตะตอนปิดเทอม');
reset role;
select pg_temp.ok((select closed_summary is not null from exams where id = (select id from stg.ids where name = 'B'))
                  and (select count(*) from item_stat_rounds) > (select stat_rounds from stg.counts),
  'ชุดเดิมที่ปิดไว้ยังอยู่ · สถิติข้อสอบเพิ่มจากชุดที่ปิดในเทอมนี้');
\echo 'staging_after: ALL PASSED (ข้อมูลเดิมไม่เปลี่ยน + ทดสอบรวมทั้งเส้นทาง)'
