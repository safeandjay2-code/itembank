-- ทดสอบเฟส 6: วิเคราะห์ผล ปิดชุด หมดอายุ (SPEC §9, §10)
--   ก) ข้อมูลจำลองที่รู้ค่า p, r ล่วงหน้า (คำนวณมือ — ดูตารางใน web/tests/unit/analysis.test.ts) ฐานข้อมูลต้องได้ค่าเดียวกัน
--   ข) fixture จากหน้าเว็บ (fixtures/phase6_analysis.json) 9 ชุด: ฐานข้อมูลต้องคำนวณตรงกับหน้าเว็บทุกค่า
--   ค) ปิดชุด: สถิติเข้าคลัง แล้วไม่เหลือข้อมูลรายเลขที่ · ง) หมดอายุอัตโนมัติ · จ) สิทธิ์
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

\set fx `cat tests/db/fixtures/phase6_analysis.json`
create temp table fx as select :'fx'::jsonb as doc;
create temp table cases as select c, (c->'exam'->>'id')::uuid as exam_id, ord from fx, jsonb_array_elements(doc->'cases') with ordinality t(c, ord);
grant select on cases to authenticated;

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@test'),
  ('00000000-0000-0000-0000-00000000000b', 'teacher@test')
on conflict (id) do nothing;
update profiles set role = 'owner' where id = '00000000-0000-0000-0000-00000000000a';
delete from exams; delete from item_stat_rounds; delete from items;

-- ===== ติดตั้งชุดข้อสอบ + ผลตรวจจาก fixture (ตรงเข้าตาราง ไม่ผ่าน exam_create) =====
insert into items(id, item_code, owner_id, subject_id, indicator_id, cognitive_level, est_difficulty, current_difficulty, status)
select (i->>'id')::uuid, i->>'item_code', '00000000-0000-0000-0000-00000000000a', 'MATH', i->>'indicator_id', 1,
       (i->>'difficulty')::int, (i->>'difficulty')::int, 'active'
from cases, jsonb_array_elements(c->'items') i;
insert into item_versions(item_id, version, content, answer, qa)
select (i->>'id')::uuid, 1, jsonb_build_object('stem', 'โจทย์', 'options', jsonb_build_array('ก','ข','ค','ง'), 'figure', null,
       'explanation', '', 'distractor_rationale', jsonb_build_array(null, null, null, null)),
       jsonb_build_object('choice', (i->>'answer')::int), '{"passed":true,"errors":[],"warnings":[]}'::jsonb
from cases, jsonb_array_elements(c->'items') i;
insert into exams(id, owner_id, title, subject_id, grade_id, item_count, set_count, student_count, status, template_version, opened_at)
select exam_id, '00000000-0000-0000-0000-00000000000a', c->>'name', 'MATH', 'P4', (c->'exam'->>'item_count')::int,
       (c->'exam'->>'set_count')::int, (c->'exam'->>'student_count')::int, 'open', 1, now()
from cases;
insert into exam_items(exam_id, item_id, item_version, base_position, indicator_id, difficulty_at_build)
select exam_id, (i->>'id')::uuid, 1, (i->>'base_position')::int, i->>'indicator_id', (i->>'difficulty')::int
from cases, jsonb_array_elements(c->'items') i;
insert into exam_set_items(exam_id, set_no, position, item_id, option_order)
select exam_id, (s->>'set_no')::int, p.ord, (p.e->>'item_id')::uuid, array(select jsonb_array_elements_text(p.e->'option_order')::smallint)
from cases, jsonb_array_elements(c->'sets') s, jsonb_array_elements(s->'entries') with ordinality p(e, ord);
insert into exam_seats(exam_id, seat_no, set_no)
select exam_id, k, ((k - 1) % (c->'exam'->>'set_count')::int) + 1 from cases, generate_series(1, (c->'exam'->>'student_count')::int) k;
insert into responses(exam_id, seat_no, set_no, answers, flags, source)
select exam_id, (r->>'seat_no')::int, (r->>'set_no')::int, r->'answers', r->'flags', 'upload'
from cases, jsonb_array_elements(c->'responses') r;

set client_min_messages = notice;
select pg_temp.ok(exists (select 1 from app_migrations where version = '0009'), 'บันทึก migration 0009');
select pg_temp.ok((select count(*) from app_settings where key in ('analysis.group_ratio','analysis.r_min_n','report.strong_distractor_ratio',
                   'report.dead_distractor_ratio','privacy.expiry_warn_days','privacy.exam_expiry_days','report.indicator_pass_ratio')) = 7,
                  'ตั้งค่าการวิเคราะห์/หมดอายุครบ 7 ค่า');
select pg_temp.ok((select bool_and(r.score = (j->>'score')::int) from cases cross join jsonb_array_elements(c->'responses') j
                   join responses r on r.exam_id = cases.exam_id and r.seat_no = (j->>'seat_no')::int), 'คะแนนที่ฐานข้อมูลคำนวณ = คะแนนที่หน้าเว็บคำนวณ');

-- ===== ก) ข้อมูลที่รู้ค่า p, r ล่วงหน้า (คำนวณมือ) =====
create temp table known as select public.analysis_item_stats(exam_id) as s, public.analysis_summary(exam_id) as m from cases where ord = 1;
select pg_temp.ok((select jsonb_agg((x->>'n_correct')::int order by (x->>'base_position')::int) from known, jsonb_array_elements(s) x) = '[7,5,4,2,3]',
                  'คำนวณมือ: ตอบถูกรายข้อ 7,5,4,2,3');
select pg_temp.ok((select array_agg((x->>'p')::numeric order by (x->>'base_position')::int) from known, jsonb_array_elements(s) x) = array[0.7,0.5,0.4,0.2,0.3]::numeric[],
                  'คำนวณมือ: p = .70 .50 .40 .20 .30');
select pg_temp.ok((select array_agg((x->>'r')::numeric order by (x->>'base_position')::int) from known, jsonb_array_elements(s) x) = array[1,0.667,1,0.667,-0.667]::numeric[],
                  'คำนวณมือ: r (27%, กลุ่มละ 3 คน) = 1.00 .67 1.00 .67 −.67');
select pg_temp.ok((select array_agg((x->>'upper_correct')::int || '/' || (x->>'lower_correct') order by (x->>'base_position')::int) from known, jsonb_array_elements(s) x)
                  = array['3/0','3/1','3/0','2/0','0/2'], 'คำนวณมือ: กลุ่มสูง/ต่ำ (คะแนนเท่ากันเรียงเลขที่) ตรง');
select pg_temp.ok((select x->'option_counts' from known, jsonb_array_elements(s) x where (x->>'base_position')::int = 4)
                  = '{"1":4,"2":2,"3":0,"4":2,"blank":1,"multi":1}', 'คำนวณมือ: จำนวนผู้เลือกแต่ละตัวเลือกต้นฉบับ (แปลงกลับจากชุดที่สลับ) ข้อ 4');
select pg_temp.ok((select (m->>'mean')::numeric = 2.1 and (m->>'sd')::numeric = 1.2 and (m->>'median')::numeric = 2 and (m->>'n')::int = 10
                          and m->'histogram' = '[0,0,4,0,3,0,1,0,2,0]' from known), 'คำนวณมือ: เฉลี่ย 2.10 S.D. 1.20 มัธยฐาน 2 n 10');
select pg_temp.ok((select m->'indicators' from known) = '[{"indicator_id":"MATH-2560-P4-01","item_count":2,"pass_count":8,"mean_ratio":0.6},{"indicator_id":"MATH-2560-P4-02","item_count":3,"pass_count":2,"mean_ratio":0.3}]',
                  'คำนวณมือ: ผ่านตัวชี้วัด A 8 คน · B 2 คน (เกณฑ์ 50%)');

-- ===== ข) fixture: ฐานข้อมูล = หน้าเว็บ ทุกชุด ทุกค่า =====
create temp table cmp as
select ord, c->>'name' as name, c->'expected' as exp, public.analysis_item_stats(exam_id) as got_items, public.analysis_summary(exam_id) as got_sum from cases;
create temp table item_cmp as
select cmp.ord, e as exp, g as got from cmp cross join jsonb_array_elements(exp->'items') e
left join lateral (select g from jsonb_array_elements(got_items) g where g->>'item_id' = e->>'item_id') x on true;
select pg_temp.ok((select count(*) from item_cmp) = (select sum(jsonb_array_length(c->'items')) from cases) and (select count(*) from item_cmp where got is null) = 0,
                  'fixture: ทุกข้อของทุกชุดมีผลจากฐานข้อมูล');
select pg_temp.ok((select count(*) from item_cmp where (got->'n', got->'n_correct', got->'group_size', got->'upper_correct', got->'lower_correct')
                   is distinct from (exp->'n', exp->'n_correct', exp->'group_size', exp->'upper_correct', exp->'lower_correct')) = 0,
                  'fixture: n ตอบถูก กลุ่มสูง/ต่ำ ตรงกันทุกข้อ');
select pg_temp.ok((select count(*) from item_cmp where got->'p' is distinct from exp->'p' or got->'r' is distinct from exp->'r') = 0,
                  'fixture: p และ r ตรงกันทุกข้อ (' || (select count(*) from item_cmp where exp->'r' <> 'null') || ' ข้อมีค่า r)');
select pg_temp.ok((select count(*) from item_cmp where got->'option_counts' is distinct from exp->'option_counts') = 0,
                  'fixture: จำนวนผู้เลือกแต่ละตัวเลือกตรงกันทุกข้อ');
select pg_temp.ok((select count(*) from cmp where (got_sum->'n', got_sum->'mean', got_sum->'median', got_sum->'min', got_sum->'max', got_sum->'mean_percent', got_sum->'histogram', got_sum->'indicators')
                   is distinct from (exp->'summary'->'n', exp->'summary'->'mean', exp->'summary'->'median', exp->'summary'->'min', exp->'summary'->'max',
                                     exp->'summary'->'mean_percent', exp->'summary'->'histogram', exp->'summary'->'indicators')) = 0,
                  'fixture: ภาพรวมห้อง (n เฉลี่ย มัธยฐาน ต่ำสุด สูงสุด ร้อยละ การกระจาย รายตัวชี้วัด) ตรงกันทุกชุด');
select pg_temp.ok((select count(*) from cmp where coalesce(abs((got_sum->>'sd')::numeric - (exp->'summary'->>'sd')::numeric) > 0.005, (got_sum->'sd') is distinct from (exp->'summary'->'sd'))) = 0,
                  'fixture: S.D. ตรงกันทุกชุด');
select pg_temp.ok((select count(*) from cmp where (exp->'summary'->>'n')::int = 0) = 1 and (select count(*) from item_cmp where exp->'r' = 'null' and (exp->>'n')::int > 0) > 0,
                  'fixture ครอบคลุม: ชุดที่ยังไม่มีผลตรวจ และชุดที่ n น้อยจนไม่คำนวณ r');

-- ===== ค) ปิดชุด =====
create temp table k as select exam_id as id from cases where ord = 1;
create temp table k2 as select exam_id as id from cases where ord = 2;
grant select on k, k2 to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.fails($$select public.exam_close((select id from k))$$, 'ไม่พบชุดข้อสอบ', 'ครูคนอื่นปิดชุดของเจ้าของไม่ได้');
select pg_temp.fails($$select public.analysis_item_stats((select id from k))$$, 'permission denied', 'ผู้ใช้เรียกฟังก์ชันวิเคราะห์ภายในโดยตรงไม่ได้');
select pg_temp.fails($$select public.exam_finalize((select id from k), 'closed')$$, 'permission denied', 'ผู้ใช้เรียกฟังก์ชันปิดชุดภายในโดยตรงไม่ได้');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
create temp table closed as select public.exam_close((select id from k)) as s;
reset role;
select pg_temp.ok((select status from exams where id = (select id from k)) = 'closed' and (select closed_at from exams where id = (select id from k)) is not null,
                  'ปิดชุดแล้วสถานะ "ปิดแล้ว"');
select pg_temp.ok((select count(*) from responses where exam_id = (select id from k)) = 0, 'หลังปิดชุด: ไม่เหลือข้อมูลรายเลขที่ (responses = 0)');
select pg_temp.ok((select (s->>'items_recorded')::int = 5 and (s->>'responses_deleted')::int = 10 from closed), 'ปิดชุด: บันทึกสถิติ 5 ข้อ ลบผลตรวจ 10 เลขที่');
select pg_temp.ok((select array_agg(s.n || ':' || s.n_correct || ':' || s.r order by i.item_code) from item_stat_rounds s join items i on i.id = s.item_id
                   where s.source_exam_id = (select id from k))
                  = array['10:7:1.000','10:5:0.667','10:4:1.000','10:2:0.667','10:3:-0.667'], 'สถิติเข้าคลัง (item_stat_rounds): n, ตอบถูก, r ตรงกับค่าคำนวณมือ');
select pg_temp.ok((select bool_and(s.grade_id = 'P4' and s.version = 1) from item_stat_rounds s where s.source_exam_id = (select id from k)), 'สถิติผูกกับชั้นและเวอร์ชันข้อที่ใช้');
select pg_temp.ok((select option_counts from item_stat_rounds s join items i on i.id = s.item_id where s.source_exam_id = (select id from k) and i.item_code = 'M-800004')
                  = '{"1":4,"2":2,"3":0,"4":2,"blank":1,"multi":1}', 'สถิติเข้าคลัง: สัดส่วนการเลือกตัวลวงเก็บไว้');
select pg_temp.ok((select p = 0.7 and n = 10 and r = 1 from item_stats where item_code = 'M-800001'), 'มุมมอง item_stats ของคลังเห็นค่า p, r ใหม่');
select pg_temp.ok((select closed_summary->>'mean' = '2.10' and (closed_summary->>'n')::int = 10 and closed_summary->>'finalized_as' = 'closed' from exams where id = (select id from k)),
                  'เก็บผลสรุประดับห้องไว้ (เฉลี่ย n)');
select pg_temp.ok((select closed_summary::text !~ 'seat' from exams where id = (select id from k)) and
                  (select bool_and(option_counts::text !~ 'seat') from item_stat_rounds where source_exam_id = (select id from k)),
                  'ผลสรุปและสถิติที่เก็บไว้ไม่มีข้อมูลรายเลขที่');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
create temp table g as select public.exam_get((select id from k)) as v;
select pg_temp.ok((select v->>'status' = 'closed' and (v->>'has_responses')::boolean = false and jsonb_array_length(v->'round_stats') = 5
                   and v->'closed_summary' is not null from g), 'exam_get หลังปิด: ไม่มีผลตรวจ มีสถิติรายข้อ 5 ข้อ + ผลสรุป');
select pg_temp.ok(public.scan_responses((select id from k)) = '[]'::jsonb, 'scan_responses หลังปิดชุด = ว่าง');
select pg_temp.fails($$select public.scan_save_response((select id from k), 1, 1, '[1,2,3,4,1]'::jsonb)$$, 'ปิดแล้ว', 'ปิดแล้วบันทึกผลตรวจเพิ่มไม่ได้');
select pg_temp.fails($$select public.exam_close((select id from k))$$, 'ปิดแล้ว', 'ปิดชุดซ้ำไม่ได้ (สถิติไม่ถูกนับซ้ำ)');
select pg_temp.ok((select count(*) from item_stat_rounds where source_exam_id = (select id from k)) = 5, 'สถิติไม่ถูกบันทึกซ้ำ');
-- ลบชุด: ปิดแล้วลบได้ สถิติยังอยู่ · กำลังสอบลบไม่ได้
select pg_temp.fails($$select public.exam_delete((select id from k2))$$, 'กำลังสอบ', 'ชุดที่กำลังสอบลบไม่ได้');
select public.exam_delete((select id from k));
reset role;
select pg_temp.ok(not exists (select 1 from exams where id = (select id from k)) and (select count(*) from item_stat_rounds where source_exam_id = (select id from k)) = 5,
                  'ลบชุดที่ปิดแล้วได้ สถิติในคลังยังอยู่');

-- ปิดชุดใหญ่ (fixture ชุดที่ 2) ผ่าน RPC: สถิติที่เก็บ = ที่หน้าเว็บคำนวณ
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.exam_close((select id from k2));
reset role;
select pg_temp.ok((select count(*) from cases cross join jsonb_array_elements(c->'expected'->'items') e
                   left join item_stat_rounds s on s.source_exam_id = cases.exam_id and s.item_id = (e->>'item_id')::uuid
                   where ord = 2 and (s.id is null or s.n <> (e->>'n')::int or s.n_correct <> (e->>'n_correct')::int
                         or s.r is distinct from (e->>'r')::numeric or s.option_counts <> e->'option_counts')) = 0,
                  'ปิดชุด 30 ข้อ 33 คน: สถิติทุกข้อในคลังตรงกับที่หน้าเว็บคำนวณ');

-- ปิดชุดที่ยังไม่มีผลตรวจ (สถานะเปิด) — ไม่บันทึกสถิติ ไม่ล้ม
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.ok((public.exam_close((select exam_id from cases where c->>'name' = 'สุ่ม 16'))->>'items_recorded')::int = 0, 'ปิดชุดที่ไม่มีผลตรวจ: ไม่บันทึกสถิติ');
reset role;

-- ชุดที่ยังไม่เริ่มตรวจ (draft) ปิดไม่ได้ ให้ลบแทน
update exams set status = 'draft', expires_at = null where id = (select exam_id from cases where c->>'name' = 'สุ่ม 13');
delete from responses where exam_id = (select exam_id from cases where c->>'name' = 'สุ่ม 13');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.fails($$select public.exam_close((select exam_id from cases where c->>'name' = 'สุ่ม 13'))$$, 'ยังไม่ได้เริ่มตรวจ', 'ชุดที่ยังไม่เริ่มตรวจปิดไม่ได้ (ให้ลบแทน)');
reset role;

-- ===== ง) หมดอายุอัตโนมัติ =====
select pg_temp.ok((select bool_and(expires_at::date = (opened_at + interval '60 days')::date) from exams where status = 'open'),
                  'ชุดที่เริ่มตรวจมีวันหมดอายุ = วันเริ่มตรวจ + 60 วัน');
-- ชุดใหม่: เริ่มตรวจผ่าน scan_save_response → ได้วันหมดอายุอัตโนมัติ
update exams set status = 'draft', opened_at = null, expires_at = null where id = (select exam_id from cases where c->>'name' = 'สุ่ม 17');
create temp table r17 as select (j->>'seat_no')::int seat, (j->>'set_no')::int setn, j->'answers' ans from cases, jsonb_array_elements(c->'responses') j where c->>'name' = 'สุ่ม 17';
delete from responses where exam_id = (select exam_id from cases where c->>'name' = 'สุ่ม 17');
grant select on r17 to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.scan_save_response((select exam_id from cases where c->>'name' = 'สุ่ม 17'), seat, setn, ans) from r17;
reset role;
select pg_temp.ok((select status = 'open' and expires_at between now() + interval '59 days 23 hours' and now() + interval '60 days 1 minute'
                   from exams where id = (select exam_id from cases where c->>'name' = 'สุ่ม 17')), 'เริ่มตรวจแล้วตั้งวันหมดอายุ 60 วันอัตโนมัติ');
-- ปรับจำนวนวันในตั้งค่าได้ (มีผลกับชุดที่เริ่มตรวจหลังจากนั้น)
update app_settings set value = '30' where key = 'privacy.exam_expiry_days';
update exams set status = 'draft', opened_at = null, expires_at = null where id = (select exam_id from cases where c->>'name' = 'สุ่ม 18');
update exams set status = 'open', opened_at = now() where id = (select exam_id from cases where c->>'name' = 'สุ่ม 18');
select pg_temp.ok((select expires_at::date = (now() + interval '30 days')::date from exams where id = (select exam_id from cases where c->>'name' = 'สุ่ม 18')),
                  'ตั้งค่าเป็น 30 วัน → ชุดที่เริ่มตรวจใหม่หมดอายุใน 30 วัน');
update app_settings set value = '60' where key = 'privacy.exam_expiry_days';

-- ครบกำหนด: สุ่ม 15 และ สุ่ม 17 · ยังไม่ครบ: สุ่ม 12, 18 (สุ่ม 11 ปิดไปแล้วข้างบน)
update exams set expires_at = now() - interval '1 minute' where id in (select exam_id from cases where c->>'name' in ('สุ่ม 15', 'สุ่ม 17'));
create temp table before_exp as select exam_id, (select count(*) from responses r where r.exam_id = cases.exam_id) as cnt from cases;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);   -- ใครเรียกก็ได้ ทำเฉพาะชุดที่ครบกำหนด
select pg_temp.ok(public.exam_expire_due() = 2, 'exam_expire_due: ชุดที่ครบกำหนด 2 ชุดถูกทำให้หมดอายุ');
select pg_temp.ok(public.exam_expire_due() = 0, 'เรียกซ้ำไม่มีชุดใหม่ (ไม่ทำซ้ำ)');
reset role;
select pg_temp.ok((select bool_and(status = 'expired') from exams where id in (select exam_id from cases where c->>'name' in ('สุ่ม 15', 'สุ่ม 17'))),
                  'ชุดที่ครบกำหนดสถานะ "หมดอายุ"');
select pg_temp.ok((select count(*) from responses where exam_id in (select exam_id from cases where c->>'name' in ('สุ่ม 15', 'สุ่ม 17'))) = 0,
                  'หมดอายุแล้วไม่เหลือข้อมูลรายเลขที่');
select pg_temp.ok((select count(*) from item_stat_rounds where source_exam_id = (select exam_id from cases where c->>'name' = 'สุ่ม 17')) = 25
                  and (select closed_summary->>'finalized_as' from exams where id = (select exam_id from cases where c->>'name' = 'สุ่ม 17')) = 'expired',
                  'หมดอายุ: สถิติรายข้อยังถูกรวมเข้าคลัง (25 ข้อ)');
select pg_temp.ok((select bool_and(e.status = 'open' and (select count(*) from responses r where r.exam_id = e.id) = b.cnt)
                   from exams e join before_exp b on b.exam_id = e.id where e.id in (select exam_id from cases where c->>'name' in ('สุ่ม 12', 'สุ่ม 18'))),
                  'ชุดที่ยังไม่ครบกำหนดไม่ถูกแตะ');
-- anon เรียกไม่ได้
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.fails($$select public.exam_expire_due()$$, 'permission denied', 'anon เรียก exam_expire_due ไม่ได้');
select pg_temp.fails($$select public.exam_close('00000000-0000-4000-e012-000000000012')$$, 'permission denied', 'anon ปิดชุดไม่ได้');
reset role;

-- ===== สรุป: ทั้งระบบไม่เหลือข้อมูลรายเลขที่ของชุดที่ปิด/หมดอายุ =====
select pg_temp.ok((select count(*) from responses r join exams e on e.id = r.exam_id where e.status in ('closed', 'expired')) = 0,
                  'ทุกชุดที่ปิด/หมดอายุ: responses = 0');

select 'ALL PHASE 6 DB TESTS PASSED';
