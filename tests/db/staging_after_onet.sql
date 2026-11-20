-- ห้อง O-NET: ตรวจหลังติดตั้ง 0015 ทับฐานสภาพระบบจริง (เรียกจาก staging.sh upgrade เมื่อ LIVE_LAST < 0015)
--   ผู้ใช้เดิมไม่เปลี่ยนบทบาทและใช้ระบบหลักได้เหมือนเดิม · ผู้สมัครใหม่ได้ onet และเข้าคลังไม่ได้
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'PASS: %', msg;
end $$;

select pg_temp.ok((select value #>> '{}' from app_settings where key = 'auth.new_user_role') = 'onet', 'O-NET: ผู้สมัครใหม่ = onet (ค่าจาก 0015)');
select pg_temp.ok(not exists (select 1 from profiles where role = 'onet'), 'O-NET: ผู้ใช้เดิมไม่มีใครถูกเปลี่ยนเป็น onet');
select pg_temp.ok((select role from profiles where id = '00000000-0000-0000-0000-0000000000aa') = 'owner', 'O-NET: owner เดิมยังเป็น owner');
select pg_temp.ok(exists (select 1 from storage.buckets where id = 'onet' and not public), 'O-NET: bucket onet ส่วนตัว');

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000f1', 'new.kru@gmail.com');
select pg_temp.ok((select role from profiles where id = '00000000-0000-0000-0000-0000000000f1') = 'onet', 'O-NET: สมัครใหม่ได้ onet');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
select pg_temp.ok(public.app_current_role() = 'owner' and jsonb_array_length(public.assembly_pool('MATH')) > 0, 'O-NET: owner ยังดึงคลังประกอบชุดได้');
select pg_temp.ok((select count(*) from items) > 0, 'O-NET: owner ยังเห็นคลัง');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
do $$ begin
  perform public.assembly_pool('MATH');
  raise exception 'FAIL: onet ดึงคลังได้';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'PASS: O-NET: ผู้สมัครใหม่ดึงคลัง (assembly_pool) ไม่ได้';
end $$;
select pg_temp.ok((select count(*) from items) = 0 and public.onet_catalog()->>'role' = 'onet', 'O-NET: ผู้สมัครใหม่มองไม่เห็นคลัง · เปิดห้อง O-NET ได้');
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000f1';
select pg_temp.ok(true, 'staging_after_onet: ALL PASSED');
