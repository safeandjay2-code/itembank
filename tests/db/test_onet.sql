-- ทดสอบห้อง O-NET (migration 0015)
--   ก) บทบาท onet เป็นค่าเริ่มต้นของผู้ใช้ใหม่  ข) ด่านกลาง app_pre_request + กันสร้างชุด/ห้องเรียนระบบหลัก
--   ค) ซ่อนเฉลยและคลังจากบัญชี onet  ง) สิทธิ์ชุดฟรี/ล็อก/ปลดล็อก  จ) ส่งผล → ตรวจคะแนนบนเซิร์ฟเวอร์ (คำนวณมือ)
--   ฉ) เลขที่ซ้ำ/แทนที่/ลบ  ช) ห้องของคนอื่น  ซ) ไฟล์ใน Storage  ฌ) ปิดห้อง → สถิติรวม + ลบรายเลขที่ · หมดอายุ
--   ญ) ผู้ดูแล
-- ชุดทดสอบ S91 (ฟรี) / S92 (ล็อก) เป็นข้อมูลสมมติ — ข้อมูลชุดติวจริงไม่อยู่ใน repo
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
create or replace function pg_temp.as_user(p uuid, p_path text default '/rpc/onet_x', p_method text default 'POST') returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false),
         set_config('request.path', p_path, false), set_config('request.method', p_method, false);
$$;

set client_min_messages = notice;

-- ---------- ก) บทบาทเริ่มต้น ----------
select pg_temp.ok((select value #>> '{}' from app_settings where key = 'auth.new_user_role') = 'onet',
  'ค่าเริ่มต้นจาก migration: ผู้ใช้ใหม่ = onet');
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@onet.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'kru.a@gmail.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'kru.b@gmail.com');
select pg_temp.ok((select role from profiles where id = '00000000-0000-0000-0000-0000000000b1') = 'onet',
  'สมัครใหม่ได้บทบาท onet อัตโนมัติ');
update profiles set role = 'owner' where id = '00000000-0000-0000-0000-0000000000a1';
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000c1', 'teacher@onet.test');
update profiles set role = 'teacher' where id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.fails($q$insert into profiles(id, role) values (gen_random_uuid(), 'student')$q$, 'profiles_role_check',
  'บทบาทนอกรายการถูกปฏิเสธ');

-- ข้อมูลชุดสมมติ (สร้างโดย superuser แทนการนำเข้าจริง)
insert into onet_sets(code, set_no, bubble_code, title, is_free) values
  ('S91', 91, '910', 'ชุดทดสอบ 91', true),
  ('S92', 92, '920', 'ชุดทดสอบ 92', false);
insert into onet_set_items(set_code, item_no, kind, answer, points, indicator_code, topic, focus, solution, traps) values
  ('S91', 1, 'mcq4', '2', 6.5, 'ค 1.1 ป.4/10', 'ระคน', 'ลำดับการคำนวณ', 'วิธี 1', 'กับดัก 1'),
  ('S91', 2, 'mcq4', '4', 6.5, 'ค 1.1 ป.6/12', 'ร้อยละ', null, 'วิธี 2', 'กับดัก 2'),
  ('S91', 3, 'numeric3', '517', 7.125, 'ค 1.1 ป.5/8', 'ทศนิยม', null, 'วิธี 3', 'กับดัก 3'),
  ('S91', 4, 'numeric3', '060', 7.125, 'ค 3.1 ป.6/1', 'วงกลม', null, 'วิธี 4', 'กับดัก 4'),
  ('S92', 1, 'mcq4', '1', 6.5, 'ค 2.1 ป.4/1', 'เวลา', null, 'ลับ', 'ลับ'),
  ('S92', 2, 'numeric3', '840', 7.125, 'ค 3.1 ป.6/1', 'วงกลม', null, 'ลับ', 'ลับ');
select pg_temp.fails($q$insert into onet_set_items(set_code, item_no, kind, answer, points, indicator_code, topic)
  values ('S91', 9, 'numeric3', '2.14', 7.125, 'x', 'x')$q$, 'onet_set_items_check', 'เฉลยระบายตัวเลขต้องเป็นจำนวนเต็ม 3 หลัก');
select pg_temp.fails($q$insert into onet_set_items(set_code, item_no, kind, answer, points, indicator_code, topic)
  values ('S91', 9, 'mcq4', '5', 6.5, 'x', 'x')$q$, 'onet_set_items_check', 'เฉลยปรนัยต้องเป็น 1–4');
insert into storage.objects(bucket_id, name) values ('onet', 'S91/exam.pdf'), ('onet', 'S92/exam.pdf'), ('onet', 'common/guide.pdf');

-- ---------- ข) ด่านกลาง ----------
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1', '/rpc/exam_create', 'POST');
select pg_temp.fails('select public.app_pre_request()', 'เฉพาะห้อง O-NET', 'onet เรียก /rpc/exam_create ไม่ได้');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1', '/items', 'GET');
select pg_temp.fails('select public.app_pre_request()', 'เฉพาะห้อง O-NET', 'onet อ่าน /items ไม่ได้');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1', '/rpc/gb_sheet', 'POST');
select pg_temp.fails('select public.app_pre_request()', 'เฉพาะห้อง O-NET', 'onet เรียก /rpc/gb_sheet ไม่ได้');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1', '/indicators', 'POST');
select pg_temp.fails('select public.app_pre_request()', 'เฉพาะห้อง O-NET', 'onet เขียน /indicators ไม่ได้');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1', '/rpc/onet_catalog', 'POST');
select public.app_pre_request();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1', '/profiles', 'GET');
select public.app_pre_request();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1', '/indicators', 'GET');
select public.app_pre_request();
select pg_temp.ok(true, 'onet ผ่านด่าน: /rpc/onet_* · อ่าน /profiles · อ่าน /indicators');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1', '/rpc/exam_create', 'POST');
select public.app_pre_request();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', '/items', 'GET');
select public.app_pre_request();
select pg_temp.ok(true, 'teacher/owner ไม่ถูกด่านกลางกั้น');
select set_config('request.jwt.claim.sub', '', false);
select public.app_pre_request();
select pg_temp.ok(true, 'ผู้ไม่ล็อกอิน (anon) ไม่ถูกด่านกลางกั้น');

-- กันชั้นที่สอง (ถ้าด่านกลางหลุด)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.fails($q$select public.assembly_pool('MATH')$q$, 'ไม่มีสิทธิ์สร้างชุดข้อสอบ', 'onet เรียก assembly_pool (ข้อ+เฉลยคลัง) ไม่ได้');
select pg_temp.ok(public.app_current_role() is null and public.app_profile_role() = 'onet', 'บัญชี onet ไม่มีบทบาทในระบบหลัก');
select pg_temp.fails($q$insert into exams(owner_id, title) values (auth.uid(), 'x')$q$, 'เฉพาะห้อง O-NET', 'onet insert exams ตรงไม่ได้');
select pg_temp.fails($q$select public.gb_classroom_create('{"grade_id":"P6","academic_year":2569,"term":2,"name":"x","student_count":5}'::jsonb)$q$,
  'เฉพาะห้อง O-NET', 'onet สร้างห้องเรียนสมุดคะแนนไม่ได้');
select pg_temp.fails($q$update profiles set role = 'teacher' where id = auth.uid()$q$, 'ไม่มีสิทธิ์เปลี่ยนบทบาท', 'onet เลื่อนบทบาทตัวเองไม่ได้');
select pg_temp.fails($q$select public.onet_room_finalize(gen_random_uuid())$q$, 'permission denied', 'ฟังก์ชันภายใน onet_room_finalize เรียกตรงไม่ได้');

-- ---------- ค) ซ่อนเฉลย/คลัง ----------
select pg_temp.ok((select count(*) from items) = 0, 'onet มองไม่เห็นคลังข้อสอบ');
select pg_temp.ok((select count(*) from onet_set_items) = 0, 'onet อ่านตารางเฉลยตรงไม่ได้');
select pg_temp.ok((select count(*) from onet_sets) = 0, 'onet อ่านตารางชุดตรงไม่ได้ (ใช้ onet_catalog)');
select pg_temp.ok(public.onet_set_detail('S91')::text not like '%"answer"%', 'onet_set_detail ไม่ส่งเฉลย');

-- ---------- ง) สิทธิ์ชุด ----------
create temp table cat as select public.onet_catalog() as c;
select pg_temp.ok((select c->>'role' from cat) = 'onet' and (select (c->>'entitled')::boolean from cat) = false, 'catalog: บทบาท onet ยังไม่ปลดล็อก');
select pg_temp.ok((select string_agg((s->>'code') || ':' || (s->>'usable'), ' ' order by s->>'code') from cat, jsonb_array_elements(c->'sets') s)
  = 'S91:true S92:false', 'catalog: ชุดฟรีใช้ได้ ชุดล็อกใช้ไม่ได้');
select pg_temp.ok((select (s->>'item_count')::int from cat, jsonb_array_elements(c->'sets') s where s->>'code' = 'S91') = 4, 'catalog: จำนวนข้อ');
select pg_temp.ok((public.onet_set_detail('S91')->'items'->0->>'solution') = 'วิธี 1', 'ชุดฟรีเห็นวิธีคิด');
select pg_temp.ok((public.onet_set_detail('S92')->'items'->0->>'solution') is null
  and (public.onet_set_detail('S92')->'items'->0->>'topic') = 'เวลา', 'ชุดล็อกเห็นหัวข้อแต่ไม่เห็นวิธีคิด/กับดัก');

-- ---------- จ) ห้อง + ส่งผล ----------
create temp table rm as select public.onet_room_create('ป.6 ปี 2569') as id;
select pg_temp.ok((select expires_at from onet_rooms where id = (select id from rm)) = date '2027-03-31', 'ห้องใหม่หมดอายุตามค่าตั้ง 31 มี.ค. 2570');
select pg_temp.fails($q$select public.onet_room_create('  ')$q$, 'ตั้งชื่อห้อง', 'ชื่อห้องว่างถูกปฏิเสธ');
select pg_temp.fails(format($q$select public.onet_submit(%L, 'S92', 1, '["1","840"]')$q$, (select id from rm)), 'ยังไม่ได้ปลดล็อก', 'ส่งผลชุดล็อกไม่ได้');
select pg_temp.fails(format($q$select public.onet_submit(%L, 'S91', 0, '["2","4","517","060"]')$q$, (select id from rm)), '1–99', 'เลขที่ 0 ถูกปฏิเสธ');
select pg_temp.fails(format($q$select public.onet_submit(%L, 'S91', 100, '["2","4","517","060"]')$q$, (select id from rm)), '1–99', 'เลขที่ 100 ถูกปฏิเสธ');
select pg_temp.fails(format($q$select public.onet_submit(%L, 'S91', 1, '["2","4","517"]')$q$, (select id from rm)), 'ไม่ตรงกับจำนวนข้อ', 'จำนวนคำตอบไม่ครบถูกปฏิเสธ');

-- เลขที่ 1: ถูกข้อ 1, 3 → 6.5 + 7.125 = 13.625 · ระบายรหัสชุดถูก
create temp table s1 as select public.onet_submit((select id from rm), 'S91', 1, '["2","1","517",null]', '910') as r;
select pg_temp.ok((select r->>'status' from s1) = 'saved' and (select (r->>'score')::numeric from s1) = 13.625
  and (select (r->>'correct_count')::int from s1) = 2 and (select r->'correct' from s1) = '[true,false,true,false]'::jsonb
  and (select (r->>'set_mismatch')::boolean from s1) = false, 'เลขที่ 1: ถูก 2 ข้อ 13.625 คะแนน (คำนวณมือ)');
-- เลขที่ 2: ถูกทุกข้อ = 6.5×2 + 7.125×2 = 27.25 · ระบายรหัสชุดผิด (920)
create temp table s2 as select public.onet_submit((select id from rm), 'S91', 2, '["2","4","517","060"]', '920') as r;
select pg_temp.ok((select (r->>'score')::numeric from s2) = 27.25 and (select (r->>'set_mismatch')::boolean from s2),
  'เลขที่ 2: เต็ม 27.25 · เตือนระบายรหัสชุดผิด (ไม่หักคะแนน)');
-- เลขที่ 3: ระบายตัวเลขไม่ครบ ("06" / null) = ผิด · ไม่ระบายรหัสชุด
create temp table s3 as select public.onet_submit((select id from rm), 'S91', 3, '["3","4","51",null]', null, '[{"item":3,"note":"คอลัมน์ว่าง"}]') as r;
select pg_temp.ok((select (r->>'score')::numeric from s3) = 6.5 and (select (r->>'set_mismatch')::boolean from s3), 'เลขที่ 3: ระบายไม่ครบ 3 หลัก = ผิด → 6.5');

-- ---------- ฉ) เลขที่ซ้ำ ----------
create temp table d1 as select public.onet_submit((select id from rm), 'S91', 1, '["2","4","517","060"]', '910') as r;
select pg_temp.ok((select r->>'status' from d1) = 'duplicate' and (select (r->'existing'->>'score')::numeric from d1) = 13.625
  and (select score from onet_results where seat_no = 1) = 13.625, 'เลขที่ซ้ำ: ไม่บันทึกทับ แจ้งคะแนนเดิม');
create temp table d2 as select public.onet_submit((select id from rm), 'S91', 1, '["2","4","517","060"]', '910', '[]', true) as r;
select pg_temp.ok((select r->>'status' from d2) = 'replaced' and (select score from onet_results where seat_no = 1) = 27.25, 'เลือกแทนที่: บันทึกทับได้');
select public.onet_result_delete((select id from rm), 'S91', 3);
select pg_temp.ok((select count(*) from onet_results) = 2, 'ลบผลเลขที่ 3 ได้');
select pg_temp.fails(format($q$select public.onet_result_delete(%L, 'S91', 3)$q$, (select id from rm)), 'ไม่พบผล', 'ลบซ้ำแจ้งไม่พบ');
select public.onet_submit((select id from rm), 'S91', 3, '["3","4","51",null]', null);

create temp table rep as select public.onet_report((select id from rm)) as r;
select pg_temp.ok((select jsonb_array_length(r->'results') from rep) = 3
  and (select r->'sets'->0->>'code' from rep) = 'S91'
  and (select r::text from rep) not like '%"answer":%', 'รายงาน: ผล 3 คน + ข้อมูลชุด ไม่มีเฉลย');
select pg_temp.ok((select string_agg((x->>'seat_no') || '=' || (x->>'score'), ' ' order by (x->>'seat_no')::int) from rep, jsonb_array_elements(r->'results') x)
  = '1=27.250 2=27.250 3=6.500', 'รายงาน: คะแนนรายเลขที่');
select pg_temp.ok((select count(*) from json_array_elements(public.onet_room_list()::json) x) = 1
  and (select (public.onet_room_list()->0->>'students')::int) = 3, 'รายการห้อง: นับนักเรียน 3 คน');

-- ---------- ช) ห้องของคนอื่น ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.fails(format($q$select public.onet_report(%L)$q$, (select id from rm)), 'ไม่พบห้อง', 'ครูอื่นเปิดรายงานห้องนี้ไม่ได้');
select pg_temp.fails(format($q$select public.onet_submit(%L, 'S91', 9, '["2","4","517","060"]')$q$, (select id from rm)), 'ไม่พบห้อง', 'ครูอื่นส่งผลเข้าห้องนี้ไม่ได้');
select pg_temp.ok((select count(*) from onet_rooms) = 0 and (select count(*) from onet_results) = 0, 'ครูอื่นมองไม่เห็นห้อง/ผลของคนอื่น');
select pg_temp.ok(public.onet_room_list() = '[]'::jsonb, 'รายการห้องของครูอื่นว่าง');

-- ---------- ซ) ไฟล์ใน Storage ----------
select pg_temp.ok((select string_agg(name, ' ' order by name collate "C") from storage.objects) = 'S91/exam.pdf common/guide.pdf',
  'ไฟล์: ยังไม่ปลดล็อกเห็นเฉพาะชุดฟรี + common');
select pg_temp.fails($q$insert into storage.objects(bucket_id, name) values ('onet', 'S93/x.pdf')$q$, 'row-level security', 'onet อัปโหลดไฟล์ไม่ได้');

-- ---------- ญ) ผู้ดูแล + ปลดล็อก ----------
select pg_temp.fails($q$select public.onet_admin_grant('00000000-0000-0000-0000-0000000000b2')$q$, 'เฉพาะผู้ดูแล', 'onet ปลดล็อกตัวเองไม่ได้');
select pg_temp.fails($q$insert into onet_entitlements(user_id) values ('00000000-0000-0000-0000-0000000000b2')$q$, 'row-level security', 'onet insert สิทธิ์ตรงไม่ได้');
select pg_temp.fails('select public.onet_admin_users()', 'เฉพาะผู้ดูแล', 'onet เปิดรายชื่อผู้ใช้ไม่ได้');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((select count(*) from jsonb_array_elements(public.onet_admin_users('gmail'))) = 2, 'ผู้ดูแลค้นอีเมล gmail เจอ 2 คน');
select public.onet_admin_grant('00000000-0000-0000-0000-0000000000b2', 'สลิป 20 พ.ย.');
select pg_temp.ok((select (x->>'entitled')::boolean and x->>'note' = 'สลิป 20 พ.ย.' from jsonb_array_elements(public.onet_admin_users('kru.b')) x),
  'ปลดล็อกแล้ว แสดงในรายชื่อพร้อมหมายเหตุ');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.ok((public.onet_catalog()->>'entitled')::boolean and public.onet_can_use_set('S92'), 'ครูที่ปลดล็อกใช้ชุดล็อกได้');
select pg_temp.ok((public.onet_set_detail('S92')->'items'->0->>'solution') = 'ลับ', 'ปลดล็อกแล้วเห็นวิธีคิด');
select pg_temp.ok((select count(*) from storage.objects) = 3, 'ปลดล็อกแล้วเห็นไฟล์ทุกชุด');
create temp table rm2 as select public.onet_room_create('ห้อง B') as id;
select pg_temp.ok((public.onet_submit((select id from rm2), 'S92', 5, '["1","841"]', '920')->>'score')::numeric = 6.5, 'ครู B ส่งผลชุด 92: 6.5');
select public.onet_submit((select id from rm2), 'S91', 5, '["1","4","517","060"]', '910');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.onet_admin_revoke('00000000-0000-0000-0000-0000000000b2');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.ok(not public.onet_can_use_set('S92'), 'ยกเลิกสิทธิ์แล้วใช้ชุดล็อกไม่ได้');
select pg_temp.fails(format($q$select public.onet_submit(%L, 'S92', 6, '["1","840"]')$q$, (select id from rm2)), 'ยังไม่ได้ปลดล็อก', 'ยกเลิกสิทธิ์แล้วส่งผลชุดล็อกไม่ได้');

-- ---------- ฌ) ปิดห้อง + สถิติ ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select public.onet_room_close((select id from rm));
select pg_temp.fails(format($q$select public.onet_submit(%L, 'S91', 4, '["2","4","517","060"]')$q$, (select id from rm)), 'ปิดแล้ว', 'ห้องปิดแล้วส่งผลไม่ได้');
select pg_temp.fails(format($q$select public.onet_room_close(%L)$q$, (select id from rm)), 'ปิดแล้ว', 'ปิดห้องซ้ำไม่ได้');
select pg_temp.ok((public.onet_room_list()->0->>'status') = 'closed', 'ห้องสถานะ closed');
select public.onet_room_delete((select id from rm));
select pg_temp.ok(public.onet_room_list() = '[]'::jsonb, 'ลบห้องที่ปิดแล้วได้');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.fails(format($q$select public.onet_room_delete(%L)$q$, (select id from rm2)), 'ปิดห้องก่อนลบ', 'ห้องที่ยังมีผลลบไม่ได้');
reset role;
-- เลขที่ 1, 2 (ทับแล้ว) ถูกหมด · เลขที่ 3 ตอบ 3,4,"51",null
select pg_temp.ok((select string_agg(item_no || ':' || n || '/' || n_correct, ' ' order by item_no) from onet_item_stats where set_code = 'S91')
  = '1:3/2 2:3/3 3:3/2 4:3/2', 'สถิติรวมห้อง A: n/ถูก ต่อข้อ (คำนวณมือ)');
select pg_temp.ok((select answer_counts from onet_item_stats where set_code = 'S91' and item_no = 4) = '{"060": 2, "_blank": 1}'::jsonb
  and (select answer_counts from onet_item_stats where set_code = 'S91' and item_no = 1) = '{"2": 2, "3": 1}'::jsonb, 'สถิติคำตอบที่เลือก (รวมไม่ระบาย)');
select pg_temp.ok((select count(*) from onet_results where room_id = (select id from rm)) = 0, 'ปิดห้องแล้วผลรายเลขที่ถูกลบ');
-- หมดอายุ: ห้อง B หมดอายุ → onet_room_list ปิดให้อัตโนมัติ และรวมสถิติต่อจากห้อง A
update onet_rooms set expires_at = current_date - 1 where id = (select id from rm2);
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.ok((public.onet_room_list()->0->>'status') = 'closed', 'ห้องหมดอายุถูกปิดอัตโนมัติเมื่อเปิดรายการห้อง');
reset role;
select pg_temp.ok((select n || '/' || n_correct from onet_item_stats where set_code = 'S91' and item_no = 1) = '4/2'
  and (select answer_counts from onet_item_stats where set_code = 'S91' and item_no = 1) = '{"1": 1, "2": 2, "3": 1}'::jsonb
  and (select n || '/' || n_correct from onet_item_stats where set_code = 'S92' and item_no = 2) = '1/0', 'สถิติสะสมข้ามห้อง');
select pg_temp.ok((select count(*) from onet_results) = 0, 'ไม่มีผลรายเลขที่ค้าง');

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((public.onet_admin_stats()->>'users')::int = 2 and (public.onet_admin_stats()->>'entitled')::int = 0
  and jsonb_array_length(public.onet_admin_stats()->'items') = 6, 'สถิติผู้ดูแล');
reset role;
select set_config('request.jwt.claim.sub', '', false);
-- ล้างข้อมูลทดสอบ (ทดสอบเฟสถัดไปใช้ฐานเดียวกันและนับผู้ใช้จากศูนย์)
delete from storage.objects where bucket_id = 'onet';
delete from onet_sets where code in ('S91', 'S92');
delete from auth.users where email like '%onet.test' or email like 'kru._@gmail.com';
select pg_temp.ok((select count(*) from profiles) = 0 and (select count(*) from onet_rooms) = 0, 'ล้างข้อมูลทดสอบ O-NET');
select pg_temp.ok(true, 'PASSED ห้อง O-NET');
