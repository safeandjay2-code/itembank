-- ทดสอบเฟส 3: ประกอบชุดข้อสอบ — คลังพร้อมใช้, บันทึกชุดพร้อมตรวจกฎซ้ำที่ฐานข้อมูล, สิทธิ์, รายละเอียดชุด, ลบชุด
-- แผนชุดข้อสอบใน fixtures/phase3_plans.json สร้างด้วยอัลกอริทึมจริงของหน้าเว็บ (web/tests/unit/assembly-fixture.test.ts)
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
grant select on fx to authenticated;
-- แผนตัวอย่าง (แผนแรกใน fixture) ใช้ทำให้พังทีละกฎ
create temp table p0 as select doc->'plans'->0 as plan from fx;
grant select on p0 to authenticated;

-- ===== 0) ผู้ใช้และคลังจำลอง =====
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@test'),
  ('00000000-0000-0000-0000-00000000000b', 'teacher@test'),
  ('00000000-0000-0000-0000-00000000000c', 'teacher2@test')
on conflict (id) do nothing;
update profiles set role = 'owner' where id = '00000000-0000-0000-0000-00000000000a';
delete from exams;
delete from items;

insert into items(id, item_code, owner_id, subject_id, indicator_id, item_type, cognitive_level, est_difficulty, current_difficulty, status, no_shuffle)
select (p->>'id')::uuid, p->>'item_code', '00000000-0000-0000-0000-00000000000a', 'MATH', p->>'indicator_id', 'mcq4', 1,
       (p->>'difficulty')::int, (p->>'difficulty')::int, 'reviewed', (p->>'no_shuffle')::boolean
from fx, jsonb_array_elements(doc->'pool') p;
insert into item_versions(item_id, version, content, answer, qa)
select (p->>'id')::uuid, 1,
       jsonb_build_object('stem', 'โจทย์ ' || (p->>'item_code'), 'options', jsonb_build_array('ก', 'ข', 'ค', 'ง'), 'figure', null,
                          'explanation', 'วิธีคิด', 'distractor_rationale', jsonb_build_array(null, null, null, null)),
       jsonb_build_object('choice', (p->>'answer')::int), '{"passed": true, "errors": [], "warnings": []}'::jsonb
from fx, jsonb_array_elements(doc->'pool') p;
insert into item_stat_rounds(item_id, version, grade_id, n, n_correct, r)
select (p->>'id')::uuid, 1, 'P5', (p->>'n')::int, (p->>'n')::int / 2, 0.3
from fx, jsonb_array_elements(doc->'pool') p where (p->>'n')::int > 0;

-- ข้อที่ไม่พร้อมใช้ในช่องเดียวกัน (ต้องไม่ถูกส่งให้ประกอบชุด)
insert into items(id, item_code, owner_id, subject_id, indicator_id, cognitive_level, est_difficulty, current_difficulty, status)
select '00000000-0000-4000-9000-000000000001', 'M-990001', '00000000-0000-0000-0000-00000000000a', 'MATH', p->>'indicator_id', 1, 1, 1, 'draft'
from fx, jsonb_array_elements(doc->'pool') p limit 1;
insert into items(id, item_code, owner_id, subject_id, indicator_id, cognitive_level, est_difficulty, current_difficulty, status)
select '00000000-0000-4000-9000-000000000002', 'M-990002', '00000000-0000-0000-0000-00000000000a', 'MATH', p->>'indicator_id', 1, 1, 1, 'needs_fix'
from fx, jsonb_array_elements(doc->'pool') p limit 1;
insert into item_versions(item_id, version, content, answer)
select id, 1, '{"stem":"ร่าง","options":["1","2","3","4"]}'::jsonb, '{"choice":1}'::jsonb from items where item_code in ('M-990001', 'M-990002');
set client_min_messages = notice;

select pg_temp.ok(exists (select 1 from app_migrations where version = '0006'), 'บันทึก migration 0006');
select pg_temp.ok((select count(*) from app_settings where key in ('assembly.max_students', 'assembly.no_shuffle_warn_ratio',
                   'assembly.similarity_warn_ratio', 'assembly.max_answer_run')) = 4, 'มีตั้งค่าใหม่ของการประกอบชุด 4 ค่า');
select pg_temp.ok(public.assembly_best_spread('{0,0,0,0}', 40) = 0 and public.assembly_best_spread('{6,0,0,0}', 4) = 5
                  and public.assembly_best_spread('{2,1,0,0}', 3) = 1, 'คำนวณการกระจายเฉลยที่ดีที่สุด');
select pg_temp.ok((select array_agg(id order by rank) from difficulty_rank) = '{1,2,3,4}', 'ลำดับความยากจากข้อมูล: ง่าย→ท้าทาย');

-- ===== 1) คลังพร้อมใช้ =====
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
create temp table pool as select public.assembly_pool('MATH') as doc;
select pg_temp.ok(jsonb_array_length((select doc from pool)) = 80, 'คลังพร้อมใช้ 80 ข้อ (ไม่รวมร่าง/ต้องแก้)');
select pg_temp.ok(not exists (select 1 from pool, jsonb_array_elements(doc) x where x->>'item_code' in ('M-990001', 'M-990002')), 'ไม่มีข้อร่าง/ต้องแก้ในคลังพร้อมใช้');
select pg_temp.ok((select bool_and((x->>'n')::int = (p->>'n')::int and (x->>'answer')::int = (p->>'answer')::int
                                   and (x->>'no_shuffle')::boolean = (p->>'no_shuffle')::boolean and (x->>'version')::int = 1)
                   from pool, jsonb_array_elements(doc) x join fx on true join lateral jsonb_array_elements(fx.doc->'pool') p on p->>'id' = x->>'id'),
                  'ข้อมูลย่อในคลังพร้อมใช้ถูกต้อง (n เฉลย ห้ามสลับ เวอร์ชัน)');
select pg_temp.ok(not exists (select 1 from pool, jsonb_array_elements(doc) x where x ? 'content' or x ? 'stem'), 'คลังพร้อมใช้ไม่ส่งโจทย์/ตัวเลือก');

-- ===== 2) บันทึกแผนทั้ง 12 แผนจากอัลกอริทึมหน้าเว็บ =====
create temp table made(k int, plan jsonb, exam uuid);
do $$
declare r record; v uuid;
begin
  for r in select k - 1 as k, plan from fx, jsonb_array_elements(doc->'plans') with ordinality t(plan, k) loop
    v := public.exam_create(r.plan);
    insert into made values (r.k, r.plan, v);
  end loop;
end $$;
select pg_temp.ok((select count(*) from made) = 12, 'ฐานข้อมูลรับแผนจากอัลกอริทึมหน้าเว็บครบ 12 แผน');
select pg_temp.ok((select bool_and(e.item_count = jsonb_array_length(m.plan->'items') and e.set_count = (m.plan->>'set_count')::int
                                   and e.student_count = (m.plan->>'student_count')::int and e.status = 'draft'
                                   and e.owner_id = '00000000-0000-0000-0000-00000000000a' and e.template_version = 1)
                   from made m join exams e on e.id = m.exam), 'ข้อมูลหัวชุดข้อสอบถูกต้อง');
select pg_temp.ok((select bool_and((select count(*) from exam_set_items s where s.exam_id = m.exam) = e.item_count * e.set_count)
                   from made m join exams e on e.id = m.exam), 'ลำดับข้อครบทุกชุด (ข้อ × ชุด)');
select pg_temp.ok((select bool_and((select count(*) from exam_seats s where s.exam_id = m.exam) = e.student_count
                                   and not exists (select 1 from exam_seats s where s.exam_id = m.exam and s.set_no <> ((s.seat_no - 1) % e.set_count) + 1))
                   from made m join exams e on e.id = m.exam), 'เลขที่วนชุด 1,2,…,S,1,… คำนวณที่ฐานข้อมูล');
select pg_temp.ok(not exists (select 1 from exam_items x join item_stats st on st.item_id = x.item_id where x.is_anchor <> (st.n >= 50)),
                  'ป้ายข้อยึดค่าคำนวณจาก n ≥ 50 ที่ฐานข้อมูล');
select pg_temp.ok(exists (select 1 from exam_items where is_anchor) and exists (select 1 from exam_items where not is_anchor), 'มีทั้งข้อยึดค่าและข้อ n น้อยในชุด');
select pg_temp.ok((select bool_and(m.plan->'build'->>'algorithm' = 'assembly.v1' and e.build_params->'build'->>'seed' is not null
                                   and jsonb_array_length(e.build_params->'rows') > 0)
                   from made m join exams e on e.id = m.exam), 'เก็บคำขอ/เมล็ดสุ่ม/อัลกอริทึมไว้ตรวจย้อนหลัง');
select pg_temp.ok(not exists (select 1 from items i where i.id in (select item_id from exam_items) and i.status <> 'active')
                  and exists (select 1 from items where status = 'reviewed'), 'ข้อที่ถูกใช้เปลี่ยนเป็น "ใช้งาน" ข้อที่ไม่ถูกใช้ยังเป็น "ตรวจแล้ว"');
select pg_temp.ok(exists (select 1 from item_events e where e.event_type = 'status_changed' and e.payload->>'to' = 'active'), 'บันทึกประวัติการเปลี่ยนเป็นใช้งาน');

-- ===== 3) รายละเอียดชุด =====
create temp table g as select public.exam_get((select exam from made where k = 5)) as d;
select pg_temp.ok(jsonb_array_length((select d->'items' from g)) = (select jsonb_array_length(plan->'items') from made where k = 5)
                  and (select d->'items'->0->'content'->>'stem' from g) like 'โจทย์ M-%', 'รายละเอียดชุดมีเนื้อหาข้อ');
select pg_temp.ok((select jsonb_array_length(d->'sets') from g) = (select (plan->>'set_count')::int from made where k = 5)
                  and (select jsonb_array_length(d->'seats') from g) = (select (plan->>'student_count')::int from made where k = 5),
                  'รายละเอียดชุดมีทุกชุดและทุกเลขที่');
select pg_temp.ok((select bool_and((e->'option_order'->>((e->>'key')::int - 1))::int = (i->>'answer')::int)
                   from g, jsonb_array_elements(d->'sets') s, jsonb_array_elements(s->'entries') e
                   join lateral jsonb_array_elements((select d->'items' from g)) i on i->>'item_id' = e->>'item_id'),
                  'เฉลยที่แสดงของทุกชุดชี้ไปที่ตัวเลือกที่ถูกจริง');
select pg_temp.ok((select bool_and((s->'entries'->0->>'position')::int = 1) from g, jsonb_array_elements(d->'sets') s), 'ตำแหน่งในชุดเริ่มที่ 1');

-- ===== 4) ฐานข้อมูลปฏิเสธแผนที่ผิดกฎ =====
select pg_temp.fails($q$select public.exam_create(jsonb_set((select plan from p0), '{items,0,item_id}', '"00000000-0000-4000-9000-000000000001"'))$q$,
  'ไม่อยู่ในสถานะพร้อมใช้', 'ปฏิเสธข้อร่าง');
select pg_temp.fails($q$select public.exam_create(jsonb_set((select plan from p0), '{items,0,version}', '2'))$q$,
  'ถูกแก้ไขระหว่างสร้างชุด', 'ปฏิเสธเวอร์ชันที่ไม่ใช่ปัจจุบัน');
select pg_temp.fails($q$select public.exam_create(jsonb_set((select plan from p0), '{rows,0,count}', '99'))$q$,
  'จำนวนข้อไม่ตรงกับที่เลือก', 'ปฏิเสธจำนวนต่อตัวชี้วัด/ระดับไม่ตรงคำขอ');
select pg_temp.fails($q$select public.exam_create(jsonb_set((select plan from p0), '{items,1,item_id}', (select plan->'items'->0->'item_id' from p0)))$q$,
  'มีข้อซ้ำ', 'ปฏิเสธข้อซ้ำ');
select pg_temp.fails($q$select public.exam_create(jsonb_set((select plan from p0), '{items,0,base_position}', '999'))$q$,
  'ลำดับมาตรฐาน', 'ปฏิเสธตำแหน่งมาตรฐานผิด');
-- สลับตำแหน่งมาตรฐานของข้อแรกกับข้อสุดท้าย (คนละกลุ่ม) → ผิดลำดับหลักสูตร
select pg_temp.fails($q$
  select public.exam_create(jsonb_set(jsonb_set(p.plan, '{items,0,base_position}', p.plan->'items'->(n-1)->'base_position'),
                                      array['items', (n-1)::text, 'base_position'], p.plan->'items'->0->'base_position'))
  from p0 p, lateral (select jsonb_array_length(p.plan->'items') as n) x$q$,
  'เรียงตามตัวชี้วัด', 'ปฏิเสธลำดับที่ไม่เรียงตามหลักสูตร/ง่าย→ยาก');
select pg_temp.fails($q$select public.exam_create(jsonb_set((select plan from p0), '{set_count}', '2'))$q$,
  'ต้องมีลำดับข้อครบทุกชุด', 'ปฏิเสธเมื่อชุดไม่ครบตามจำนวนชุด');
select pg_temp.fails($q$select public.exam_create(jsonb_set((select plan from p0), '{sets,0,entries,0,item_id}',
                       (select to_jsonb(id) from items where status = 'reviewed' and id not in (select (x->>'item_id')::uuid from p0, jsonb_array_elements(plan->'items') x) limit 1)))$q$,
  'ทุกชุดต้องใช้ข้อชุดเดียวกัน', 'ปฏิเสธชุดที่ใช้ข้อต่างจากชุดอื่น');
-- ย้ายข้อสุดท้ายของชุดไปไว้ตำแหน่งแรก → ข้ามกลุ่ม
select pg_temp.fails($q$
  select public.exam_create(jsonb_set(p.plan, '{sets,0,entries}',
    (select jsonb_agg(e order by case when k = n then 0 else k end) from jsonb_array_elements(p.plan->'sets'->0->'entries') with ordinality t(e, k))))
  from p0 p, lateral (select jsonb_array_length(p.plan->'items') as n) x$q$,
  'เฉพาะภายในกลุ่ม', 'ปฏิเสธการสลับข้อข้ามกลุ่มตัวชี้วัด/ระดับ');
select pg_temp.fails($q$select public.exam_create(jsonb_set((select plan from p0), '{sets,0,entries,0,option_order}', '[1,1,2,3]'))$q$,
  'การสลับของตัวเลือก 1–4', 'ปฏิเสธลำดับตัวเลือกที่ไม่ใช่การเรียงสับเปลี่ยน');
select pg_temp.fails($q$select public.exam_create(jsonb_set((select plan from p0), '{sets,0,entries,0,option_order}', '[1,2,3]'))$q$,
  'การสลับของตัวเลือก 1–4', 'ปฏิเสธตัวเลือกไม่ครบ 4');
-- ข้อห้ามสลับ: หาแผนที่มีข้อห้ามสลับ แล้วสลับตัวเลือกของข้อนั้น
select pg_temp.fails($q$
  select public.exam_create(jsonb_set(m.plan, array['sets','0','entries',(t.k - 1)::text,'option_order'], '[2,1,3,4]'))
  from made m, jsonb_array_elements(m.plan->'sets'->0->'entries') with ordinality t(e, k)
  join items i on i.id = (t.e->>'item_id')::uuid
  where i.no_shuffle limit 1$q$,
  'ห้ามสลับตัวเลือก', 'ปฏิเสธการสลับตัวเลือกของข้อห้ามสลับ');
-- ทำให้เฉลยชุดที่ 1 ไปอยู่ตัวเลือก 1 ทุกข้อ (ยกเว้นข้อห้ามสลับ) → ไม่สมดุล
select pg_temp.fails($q$
  select public.exam_create(jsonb_set(p.plan, '{sets,0,entries}', (
    select jsonb_agg(case when i.no_shuffle then e
                          else jsonb_set(e, '{option_order}', (select jsonb_agg(o order by o <> a, o) from generate_series(1, 4) o)) end order by k)
    from jsonb_array_elements(p.plan->'sets'->0->'entries') with ordinality t(e, k)
    join items i on i.id = (e->>'item_id')::uuid
    join item_versions v on v.item_id = i.id and v.version = 1,
    lateral (select (v.answer->>'choice')::int as a) aa)))
  from p0 p$q$,
  'กระจายไม่สมดุล', 'ปฏิเสธชุดที่เฉลยไม่สมดุล');
select pg_temp.fails($q$select public.exam_create(jsonb_set((select plan from p0), '{set_count}', '11'))$q$, 'จำนวนชุดต้องอยู่ระหว่าง 1–10', 'ปฏิเสธจำนวนชุดเกินตั้งค่า');
select pg_temp.fails($q$select public.exam_create(jsonb_set((select plan from p0), '{student_count}', '0'))$q$, 'จำนวนนักเรียนต้องอยู่ระหว่าง 1–60', 'ปฏิเสธนักเรียน 0 คน');
select pg_temp.fails($q$select public.exam_create(jsonb_set((select plan from p0), '{student_count}', '61'))$q$, 'จำนวนนักเรียนต้องอยู่ระหว่าง 1–60', 'ปฏิเสธนักเรียนเกินตั้งค่า');
select pg_temp.fails($q$select public.exam_create(jsonb_set((select plan from p0), '{title}', '"  "'))$q$, 'ชื่อแบบทดสอบ', 'ปฏิเสธชื่อว่าง');
select pg_temp.fails($q$select public.exam_create((select plan from p0) - 'sets')$q$, 'ข้อมูลชุดข้อสอบไม่ครบ', 'ปฏิเสธข้อมูลไม่ครบ');
select pg_temp.ok((select count(*) from exams) = 12, 'แผนที่ถูกปฏิเสธไม่ทิ้งข้อมูลค้าง');
-- ส่งเลขที่มาเองถูกเพิกเฉย (ฐานข้อมูลคำนวณเอง)
create temp table own as select public.exam_create(jsonb_set((select plan from p0), '{seats}', '[{"seat_no":1,"set_no":9}]')) as id;
select pg_temp.ok((select set_no from exam_seats where exam_id = (select id from own) and seat_no = 1) = 1, 'ไม่รับเลขที่→ชุดจากหน้าเว็บ');

-- ===== 5) สิทธิ์ =====
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.fails($q$select public.assembly_pool('MATH')$q$, 'permission denied', 'ผู้ไม่ล็อกอินดูคลังพร้อมใช้ไม่ได้');
select pg_temp.fails($q$select public.exam_create((select '{}'::jsonb))$q$, 'permission denied', 'ผู้ไม่ล็อกอินสร้างชุดไม่ได้');
select pg_temp.fails($q$select public.exam_get('00000000-0000-0000-0000-000000000000')$q$, 'permission denied', 'ผู้ไม่ล็อกอินดูชุดไม่ได้');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.fails($q$select public.exam_create((select plan from p0))$q$, 'ต้องเข้าสู่ระบบ', 'ไม่มีผู้ใช้ สร้างชุดไม่ได้');

-- ครู (teacher): สร้างชุดของตัวเองได้ เห็นเฉพาะข้อในชุดตัวเอง
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.ok((select count(*) from items) = 0 and (select count(*) from item_versions) = 0, 'ครูอ่านตารางคลังโดยตรงไม่ได้');
select pg_temp.ok(jsonb_array_length(public.assembly_pool('MATH')) = 80, 'ครูดูข้อมูลย่อของคลังพร้อมใช้ได้ (ไม่มีโจทย์)');
create temp table tex as select public.exam_create(jsonb_set((select plan from p0), '{title}', '"ชุดของครู"')) as id;
select pg_temp.ok((select owner_id from exams where id = (select id from tex)) = '00000000-0000-0000-0000-00000000000b', 'ครูสร้างชุดข้อสอบของตัวเองได้');
select pg_temp.ok((select count(*) from exams) = 1, 'ครูเห็นเฉพาะชุดของตัวเอง');
select pg_temp.ok((public.exam_get((select id from tex))->'items'->0->'content'->>'stem') like 'โจทย์%', 'ครูเห็นเนื้อหาข้อในชุดของตัวเอง');
select pg_temp.fails($q$select public.exam_get((select exam from made where k = 0))$q$, 'ไม่พบชุดข้อสอบ', 'ครูดูชุดของคนอื่นไม่ได้');
select pg_temp.fails($q$select public.exam_delete((select exam from made where k = 0))$q$, 'ไม่พบชุดข้อสอบ', 'ครูลบชุดของคนอื่นไม่ได้');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select pg_temp.ok((select count(*) from exams) = 0 and (select count(*) from exam_set_items) = 0 and (select count(*) from exam_seats) = 0,
                  'ครูอีกคนไม่เห็นชุดหรือข้อมูลลูกของใครเลย');
select pg_temp.fails($q$select public.exam_get((select id from tex))$q$, 'ไม่พบชุดข้อสอบ', 'ครูอีกคนดูชุดของครูคนแรกไม่ได้');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.ok((select count(*) from exams) = 14, 'เจ้าของระบบเห็นทุกชุด');

-- ===== 6) ลบชุด =====
select public.exam_delete((select id from own));
select pg_temp.ok(not exists (select 1 from exams where id = (select id from own)) and not exists (select 1 from exam_set_items where exam_id = (select id from own)),
                  'ลบชุดที่ยังไม่มีคำตอบได้ (ข้อมูลลูกหายด้วย)');
select pg_temp.ok((select count(*) from items where status = 'active') > 0, 'ลบชุดแล้วข้อในคลังยังอยู่');
-- (เฟส 5: คำตอบต้องครบจำนวนข้อ — ใช้ "ไม่ฝน" ทุกข้อ)
insert into responses(exam_id, seat_no, set_no, answers) select exam, 1, 1, (select jsonb_agg(null::int) from generate_series(1, item_count))
  from made join exams on exams.id = made.exam where k = 0;
select pg_temp.fails($q$select public.exam_delete((select exam from made where k = 0))$q$, 'ลบได้เฉพาะชุดที่ยังไม่เริ่มสอบ', 'ลบชุดที่มีคำตอบแล้วไม่ได้');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select public.exam_delete((select id from tex));
select pg_temp.ok((select count(*) from exams) = 0, 'ครูลบชุดของตัวเองได้');

-- ===== 7) ลบข้อหุ่นแล้วชุดทดสอบที่ใช้ข้อหุ่นหายด้วย =====
reset role;
create temp table smp as select id from items where status = 'reviewed' order by item_code limit 1;
grant select on smp to authenticated;
update items set is_sample = true where id = (select id from smp);
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
create temp table sx as select public.exam_create(jsonb_build_object('title', 'ชุดข้อหุ่น', 'subject_id', 'MATH', 'grade_id', 'P5',
  'set_count', 1, 'student_count', 1,
  'rows', jsonb_build_array(jsonb_build_object('indicator_id', i.indicator_id, 'difficulty', i.current_difficulty, 'count', 1)),
  'items', jsonb_build_array(jsonb_build_object('item_id', i.id, 'version', 1, 'base_position', 1)),
  'sets', jsonb_build_array(jsonb_build_object('set_no', 1, 'entries', jsonb_build_array(jsonb_build_object('item_id', i.id, 'option_order', '[1,2,3,4]'::jsonb))))))
  as id from items i where i.id = (select id from smp);
select pg_temp.ok((select status from items where id = (select id from smp)) = 'active', 'แผนที่สร้างด้วยมือ (1 ข้อ 1 ชุด) บันทึกได้ และข้อหุ่นเป็นใช้งาน');
select pg_temp.ok(public.bank_remove_sample_items() = 1, 'ลบข้อหุ่นได้แม้ถูกใช้ในชุด');
select pg_temp.ok(not exists (select 1 from exams where id = (select id from sx)), 'ชุดที่ใช้ข้อหุ่นถูกลบไปด้วย');
select pg_temp.ok((select count(*) from exams) = 12, 'ชุดที่ไม่ใช้ข้อหุ่นยังอยู่');

reset role;
delete from exams;
delete from items;
\echo ALL PHASE 3 DB TESTS PASSED
