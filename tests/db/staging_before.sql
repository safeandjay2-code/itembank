-- One Stop เฟส 6: จำลอง "ข้อมูลที่ครูใช้อยู่จริง" บนฐานสภาพระบบจริง (0001–0010) ก่อนติดตั้ง migration ใหม่
--   ใช้โดย tests/db/staging.sh upgrade · ตรวจผลหลังติดตั้งด้วย staging_after.sql
--   ชุด A = เปิดสอบอยู่ ตรวจไปแล้ว 2 คน · ชุด B = สอบเสร็จแล้วปิดชุด · ชุด C = ยังไม่เริ่มสอบ
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

\set fx `cat tests/db/fixtures/phase3_plans.json`
create schema stg;
create table stg.fx as select :'fx'::jsonb as doc;
create table stg.pl as select (k - 1)::int as k, plan from stg.fx, jsonb_array_elements(doc->'plans') with ordinality t(plan, k);
grant usage, create on schema stg to authenticated;
grant select on all tables in schema stg to authenticated;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000e1', 'live-teacher@staging.local');
insert into items(id, item_code, owner_id, subject_id, indicator_id, item_type, cognitive_level, est_difficulty, current_difficulty, status, no_shuffle)
select (p->>'id')::uuid, p->>'item_code', '00000000-0000-0000-0000-0000000000e1', 'MATH', p->>'indicator_id', 'mcq4', 1,
       (p->>'difficulty')::int, (p->>'difficulty')::int, 'reviewed', (p->>'no_shuffle')::boolean
from stg.fx, jsonb_array_elements(doc->'pool') p;
insert into item_versions(item_id, version, content, answer, qa)
select (p->>'id')::uuid, 1,
       jsonb_build_object('stem', 'โจทย์', 'options', jsonb_build_array('ก', 'ข', 'ค', 'ง'), 'figure', null,
                          'explanation', '', 'distractor_rationale', jsonb_build_array(null, null, null, null)),
       jsonb_build_object('choice', (p->>'answer')::int), '{"passed": true, "errors": [], "warnings": []}'::jsonb
from stg.fx, jsonb_array_elements(doc->'pool') p;

-- คำตอบของเลขที่หนึ่ง (ถูกหมด/ผิดหมด) ตามชุดของเลขที่นั้น
create function stg.answers(p_exam uuid, p_seat int, p_correct boolean) returns jsonb language sql as $$
  select jsonb_agg(case when p_correct then (e->>'key')::int else ((e->>'key')::int % 4) + 1 end order by (e->>'position')::int)
  from jsonb_array_elements(public.exam_get(p_exam)->'sets') s, jsonb_array_elements(s->'entries') e
  where (s->>'set_no')::int = (select set_no from public.exam_seats where exam_id = p_exam and seat_no = p_seat)
$$;
create function stg.scan(p_exam uuid, p_seat int, p_correct boolean) returns void language sql as $$
  select null::void from (select public.scan_save_response(p_exam => p_exam, p_seat => p_seat,
    p_set => (select set_no from public.exam_seats where exam_id = p_exam and seat_no = p_seat),
    p_answers => stg.answers(p_exam, p_seat, p_correct), p_replace => true)) x
$$;
grant execute on all functions in schema stg to authenticated;
create table stg.ids(name text primary key, id uuid);
grant all on stg.ids to authenticated;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
insert into stg.ids values ('A', public.exam_create(p => (select plan from stg.pl where k = 1)));
insert into stg.ids values ('B', public.exam_create(p => (select plan from stg.pl where k = 0)));
insert into stg.ids values ('C', public.exam_create(p => (select plan from stg.pl where k = 1)));
select stg.scan((select id from stg.ids where name = 'A'), 1, true);
select stg.scan((select id from stg.ids where name = 'A'), 2, false);
select stg.scan((select id from stg.ids where name = 'B'), 1, true);
select stg.scan((select id from stg.ids where name = 'B'), 2, true);
select stg.scan((select id from stg.ids where name = 'B'), 3, false);
select public.exam_close(p_exam => (select id from stg.ids where name = 'B'));

-- ภาพก่อนติดตั้ง (เทียบหลังติดตั้ง)
create table stg.before as
select e.id, e.status, e.expires_at, e.closed_summary, e.student_count, e.item_count,
       (select count(*) from responses r where r.exam_id = e.id) as responses,
       (select coalesce(jsonb_agg(r.answers order by r.seat_no), '[]'::jsonb) from responses r where r.exam_id = e.id) as answers,
       (select count(*) from item_stat_rounds s where s.source_exam_id = e.id) as stat_rounds,
       public.exam_get(e.id) as exam_doc
from exams e;
reset role;
update stg.before b set stat_rounds = (select count(*) from item_stat_rounds s where s.source_exam_id = b.id),
                        responses = (select count(*) from responses r where r.exam_id = b.id);
create table stg.counts as select (select count(*) from items) items, (select count(*) from item_stat_rounds) stat_rounds,
  (select count(*) from exams) exams, (select string_agg(version, ',' order by version) from app_migrations) migrations;
