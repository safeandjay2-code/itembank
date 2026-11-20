-- =====================================================================
-- 0015_onet.sql — ห้อง O-NET (SPEC-ONET.md ในโฟลเดอร์โปรเจกต์)
--   * บทบาทใหม่ 'onet' = ครูที่สมัครเองด้วย Gmail เห็นเฉพาะห้อง O-NET
--     ผู้ใช้ใหม่ได้บทบาทตาม app_settings 'auth.new_user_role' (ค่าเริ่ม 'onet')
--   * ด่านกลาง app_pre_request (PostgREST db-pre-request): บัญชี onet เรียกได้เฉพาะ /rpc/onet_* + อ่านโปรไฟล์/ข้อมูลอ้างอิง
--     + trigger กันสร้างชุดข้อสอบ/ห้องเรียนของระบบหลัก (กันสองชั้น)
--   * ชุดติวสำเร็จรูป (onet_sets / onet_set_items) — เฉลยอยู่บนเซิร์ฟเวอร์เท่านั้น ตรวจคะแนนด้วย onet_submit
--   * สิทธิ์: ชุดฟรี หรือ ปลดล็อกแล้ว (onet_entitlements โดย owner/admin)
--   * ห้อง O-NET (onet_rooms) + ผลรายเลขที่ (onet_results) — ปิดห้อง = รวมสถิติเข้า onet_item_stats แล้วลบรายเลขที่
--   * ไฟล์ชุดติว: Storage bucket 'onet' (ส่วนตัว) อ่านได้เมื่อมีสิทธิ์ชุดนั้น
--   ข้อมูลชุดติวจริง (เฉลย) ไม่อยู่ใน repo สาธารณะ — นำเข้าด้วยไฟล์ seed ส่วนตัวผ่าน SQL Editor
-- =====================================================================
begin;
select public.app_begin_migration('0015', 'onet room: onet role, request gate, sets, rooms, results, storage');

-- ---------- บทบาท onet ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner','admin','teacher','onet'));

insert into public.app_settings(key, value, description_th) values
  ('auth.new_user_role', '"onet"'::jsonb, 'บทบาทของผู้ใช้ที่สมัครใหม่ (onet = ใช้ได้เฉพาะห้อง O-NET · teacher = ใช้ระบบหลักได้)'),
  ('onet.room_expire_date', '"2027-03-31"'::jsonb, 'ห้อง O-NET: วันหมดอายุเริ่มต้นของห้องที่สร้างใหม่ (ปิดห้องและลบผลรายเลขที่อัตโนมัติ)'),
  ('onet.max_open_rooms', '10'::jsonb, 'ห้อง O-NET: จำนวนห้องที่เปิดพร้อมกันได้สูงสุดต่อครู'),
  ('onet.price_text', '"ปลดล็อกชุดที่ 3–6"'::jsonb, 'ห้อง O-NET: ข้อความราคา/แพ็กเกจบนหน้าชุดที่ล็อก'),
  ('onet.payment_text', '""'::jsonb, 'ห้อง O-NET: วิธีชำระเงิน/ส่งสลิป (แสดงบนหน้าชุดที่ล็อก)')
on conflict (key) do nothing;

create or replace function public.tg_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_role text := public.app_setting_json('auth.new_user_role', '"onet"'::jsonb) #>> '{}';
begin
  if v_role is null or v_role not in ('teacher','onet') then v_role := 'onet'; end if;
  insert into public.profiles(id, display_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email), v_role)
  on conflict (id) do nothing;
  return new;
end $$;

-- บทบาทจริงในโปรไฟล์ (รวม onet)
create or replace function public.app_profile_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.app_is_onet_user()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_profile_role() = 'onet', false)
$$;

-- บทบาทในระบบหลัก: บัญชี onet = null (ไม่มีสิทธิ์ระบบหลัก)
--   ฟังก์ชันระบบหลักที่ตรวจ "app_current_role() is null → ไม่มีสิทธิ์" (เช่น assembly_pool ที่คืนเฉลยคลัง) จึงปฏิเสธ onet เอง
create or replace function public.app_current_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and role <> 'onet'
$$;

-- ---------- ด่านกลาง: บัญชี onet ใช้ได้เฉพาะห้อง O-NET ----------
-- PostgREST เรียกฟังก์ชันนี้ก่อนทุกคำขอ (ตั้งค่า pgrst.db_pre_request ด้านล่าง)
create or replace function public.app_pre_request()
returns void language plpgsql stable security definer set search_path = public as $$
declare
  v_path text := coalesce(current_setting('request.path', true), '');
  v_method text := upper(coalesce(current_setting('request.method', true), 'GET'));
begin
  if not public.app_is_onet_user() then return; end if;
  if v_path like '/rpc/onet\_%' then return; end if;
  if v_path = '/profiles' and v_method in ('GET','HEAD','PATCH') then return; end if;
  if v_method in ('GET','HEAD') and v_path in ('/subjects','/grades','/strands','/standards','/indicators',
       '/difficulty_levels','/cognitive_levels','/item_types','/app_migrations') then return; end if;
  raise exception 'บัญชีนี้ใช้ได้เฉพาะห้อง O-NET' using errcode = '42501';
end $$;

do $$
begin
  execute 'alter role authenticator set pgrst.db_pre_request = ''public.app_pre_request''';
  perform pg_notify('pgrst', 'reload config');
exception when others then
  raise notice 'ข้ามการตั้ง pgrst.db_pre_request (ไม่มี role authenticator — ฐานทดสอบ): %', sqlerrm;
end $$;

-- กันชั้นที่สอง: บัญชี onet สร้างชุดข้อสอบ/ห้องเรียนของระบบหลักไม่ได้ ไม่ว่าเรียกผ่านฟังก์ชันใด
create or replace function public.tg_block_onet_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.app_is_onet_user() then
    raise exception 'บัญชีนี้ใช้ได้เฉพาะห้อง O-NET' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger exams_block_onet before insert on public.exams
  for each row execute function public.tg_block_onet_user();
create trigger gb_classrooms_block_onet before insert on public.gb_classrooms
  for each row execute function public.tg_block_onet_user();

-- ---------- ชุดติวสำเร็จรูป ----------
create table public.onet_sets (
  code        text primary key,                      -- 'S01' (ตรงกับ QR ON1:S01:…)
  exam_kind   text not null default 'ONET',
  subject_id  text not null default 'MATH' references public.subjects(id),
  grade_id    text not null default 'P6' references public.grades(id),
  set_no      int  not null check (set_no > 0),
  bubble_code text not null,                          -- รหัสชุดที่เด็กระบาย เช่น '100'
  title       text not null,
  is_free     boolean not null default false,
  published   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (exam_kind, subject_id, grade_id, set_no),
  unique (exam_kind, subject_id, grade_id, bubble_code)
);

create table public.onet_set_items (
  set_code         text not null references public.onet_sets(code) on delete cascade,
  item_no          int  not null check (item_no > 0),
  kind             text not null check (kind in ('mcq4','numeric3')),
  answer           text not null,
  points           numeric(6,3) not null check (points > 0),
  indicator_code   text not null,                     -- ตัวชี้วัดปลายทาง เช่น 'ค 1.1 ป.6/12'
  topic            text not null,                     -- แม่แบบ/หัวข้อ
  source_indicator text,                              -- ตัวชี้วัดต้นทาง (ถ้ามี)
  focus            text,                              -- "ควรเน้น" สั้น ๆ
  solution         text,                              -- วิธีคิดสั้นที่สุด
  traps            text,                              -- ตัวลวง/กับดัก
  primary key (set_code, item_no),
  check ((kind = 'mcq4' and answer in ('1','2','3','4')) or (kind = 'numeric3' and answer ~ '^[0-9]{3}$'))
);

create table public.onet_entitlements (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  note       text
);

create or replace function public.onet_has_entitlement()
returns boolean language sql stable security definer set search_path = public as $$
  select public.app_is_bank_admin() or exists (select 1 from onet_entitlements where user_id = auth.uid())
$$;

create or replace function public.onet_can_use_set(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    public.app_is_bank_admin()
    or exists (select 1 from onet_sets s where s.code = p_code and s.published
               and (s.is_free or exists (select 1 from onet_entitlements e where e.user_id = auth.uid())))
  )
$$;

-- ---------- ห้อง + ผล ----------
create table public.onet_rooms (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 80),
  status     text not null default 'open' check (status in ('open','closed')),
  expires_at date not null,
  created_at timestamptz not null default now(),
  closed_at  timestamptz
);
create index onet_rooms_owner_idx on public.onet_rooms(owner_id, status);

create table public.onet_results (
  room_id     uuid not null references public.onet_rooms(id) on delete cascade,
  set_code    text not null references public.onet_sets(code),
  seat_no     int  not null check (seat_no between 1 and 99),
  answers     jsonb not null,                          -- ["2","4",null,…,"517"] ตามลำดับข้อ
  correct     jsonb not null,                          -- [true,false,…]
  score       numeric(7,3) not null,
  bubbled_set text,                                    -- รหัสชุดที่เด็กระบาย (null = ไม่ระบาย/อ่านไม่ได้)
  remarks     jsonb not null default '[]'::jsonb,
  scanned_at  timestamptz not null default now(),
  primary key (room_id, set_code, seat_no)
);

create table public.onet_item_stats (
  set_code      text not null references public.onet_sets(code) on delete cascade,
  item_no       int  not null,
  n             int  not null default 0,
  n_correct     int  not null default 0,
  answer_counts jsonb not null default '{}'::jsonb,   -- {"1":12,"2":3,…} / {"517":8,"_blank":2}
  updated_at    timestamptz not null default now(),
  primary key (set_code, item_no)
);

-- ---------- RLS (เขียนผ่านฟังก์ชันเท่านั้น) ----------
alter table public.onet_sets enable row level security;
alter table public.onet_set_items enable row level security;
alter table public.onet_entitlements enable row level security;
alter table public.onet_rooms enable row level security;
alter table public.onet_results enable row level security;
alter table public.onet_item_stats enable row level security;

create policy onet_sets_admin on public.onet_sets for all to authenticated
  using (public.app_is_bank_admin()) with check (public.app_is_bank_admin());
create policy onet_set_items_admin on public.onet_set_items for all to authenticated
  using (public.app_is_bank_admin()) with check (public.app_is_bank_admin());
create policy onet_item_stats_admin on public.onet_item_stats for all to authenticated
  using (public.app_is_bank_admin()) with check (public.app_is_bank_admin());
create policy onet_entitlements_read on public.onet_entitlements for select to authenticated
  using (user_id = auth.uid() or public.app_is_bank_admin());
create policy onet_entitlements_admin on public.onet_entitlements for all to authenticated
  using (public.app_is_bank_admin()) with check (public.app_is_bank_admin());
create policy onet_rooms_owner_read on public.onet_rooms for select to authenticated
  using (owner_id = auth.uid() or public.app_is_bank_admin());
create policy onet_results_owner_read on public.onet_results for select to authenticated
  using (exists (select 1 from public.onet_rooms r where r.id = room_id
                 and (r.owner_id = auth.uid() or public.app_is_bank_admin())));

-- ---------- ฟังก์ชันภายใน ----------
create or replace function public.onet_require_user()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or public.app_profile_role() is null then
    raise exception 'ต้องเข้าสู่ระบบก่อน' using errcode = '42501';
  end if;
end $$;

create or replace function public.onet_require_room(p_room uuid, p_open boolean default true)
returns public.onet_rooms language plpgsql security definer set search_path = public as $$
declare r onet_rooms;
begin
  perform public.onet_require_user();
  select * into r from onet_rooms where id = p_room and (owner_id = auth.uid() or public.app_is_bank_admin());
  if not found then raise exception 'ไม่พบห้อง O-NET'; end if;
  if p_open and r.status <> 'open' then raise exception 'ห้องนี้ปิดแล้ว'; end if;
  if p_open and r.expires_at < current_date then raise exception 'ห้องนี้หมดอายุแล้ว'; end if;
  return r;
end $$;

-- รวมสถิติรายข้อของห้องเข้า onet_item_stats แล้วลบผลรายเลขที่ (ใช้ตอนปิดห้อง/หมดอายุ)
create or replace function public.onet_room_finalize(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  with x as (
    select r.set_code, i.item_no,
           coalesce(r.answers ->> (i.item_no - 1), '_blank') as ans,
           coalesce((r.correct ->> (i.item_no - 1))::boolean, false) as ok
    from onet_results r join onet_set_items i on i.set_code = r.set_code
    where r.room_id = p_room),
  agg as (select set_code, item_no, count(*)::int as n, (count(*) filter (where ok))::int as nc
          from x group by set_code, item_no),
  cnt as (select set_code, item_no, jsonb_object_agg(ans, c) as counts
          from (select set_code, item_no, ans, count(*) as c from x group by set_code, item_no, ans) z
          group by set_code, item_no)
  insert into onet_item_stats(set_code, item_no, n, n_correct, answer_counts)
  select a.set_code, a.item_no, a.n, a.nc, c.counts
  from agg a join cnt c on c.set_code = a.set_code and c.item_no = a.item_no
  on conflict (set_code, item_no) do update set
    n = onet_item_stats.n + excluded.n,
    n_correct = onet_item_stats.n_correct + excluded.n_correct,
    answer_counts = (
      select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
        select k, sum(v::int) as v from (
          select key as k, value as v from jsonb_each_text(onet_item_stats.answer_counts)
          union all
          select key, value from jsonb_each_text(excluded.answer_counts)) u
        group by k) s),
    updated_at = now();
  delete from onet_results where room_id = p_room;
  update onet_rooms set status = 'closed', closed_at = now() where id = p_room;
end $$;

create or replace function public.onet_expire_due()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from onet_rooms where status = 'open' and expires_at < current_date
           and (owner_id = auth.uid() or public.app_is_bank_admin() or auth.uid() is null) loop
    perform public.onet_room_finalize(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- ฟังก์ชันสำหรับครู ----------
-- รายการชุด + สิทธิ์ของผู้ใช้ปัจจุบัน
create or replace function public.onet_catalog()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.onet_require_user();
  return jsonb_build_object(
    'role', public.app_profile_role(),
    'entitled', public.onet_has_entitlement(),
    'price_text', public.app_setting_json('onet.price_text', '""'::jsonb) #>> '{}',
    'payment_text', public.app_setting_json('onet.payment_text', '""'::jsonb) #>> '{}',
    'sets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', s.code, 'set_no', s.set_no, 'title', s.title, 'bubble_code', s.bubble_code,
        'subject_id', s.subject_id, 'grade_id', s.grade_id, 'is_free', s.is_free,
        'usable', public.onet_can_use_set(s.code),
        'item_count', (select count(*) from onet_set_items i where i.set_code = s.code))
        order by s.exam_kind, s.subject_id, s.grade_id, s.set_no)
      from onet_sets s where s.published), '[]'::jsonb));
end $$;

-- ข้อมูลรายข้อของชุด (ไม่มีเฉลย) — วิธีคิด/กับดักให้เฉพาะชุดที่ใช้ได้
create or replace function public.onet_set_detail(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_use boolean;
begin
  perform public.onet_require_user();
  if not exists (select 1 from onet_sets where code = p_code and (published or public.app_is_bank_admin())) then
    raise exception 'ไม่พบชุด O-NET';
  end if;
  v_use := public.onet_can_use_set(p_code);
  return (select jsonb_build_object(
    'code', s.code, 'set_no', s.set_no, 'title', s.title, 'bubble_code', s.bubble_code,
    'is_free', s.is_free, 'usable', v_use,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'item_no', i.item_no, 'kind', i.kind, 'points', i.points,
        'indicator_code', i.indicator_code, 'topic', i.topic,
        'source_indicator', i.source_indicator, 'focus', i.focus,
        'solution', case when v_use then i.solution end,
        'traps', case when v_use then i.traps end) order by i.item_no), '[]'::jsonb)
      from onet_set_items i where i.set_code = s.code))
    from onet_sets s where s.code = p_code);
end $$;

create or replace function public.onet_room_create(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_max int := public.app_setting_num('onet.max_open_rooms', 10);
begin
  perform public.onet_require_user();
  if p_name is null or length(btrim(p_name)) = 0 then raise exception 'กรุณาตั้งชื่อห้อง'; end if;
  if (select count(*) from onet_rooms where owner_id = auth.uid() and status = 'open') >= v_max then
    raise exception 'เปิดห้องได้สูงสุด % ห้อง กรุณาปิดห้องเก่าก่อน', v_max;
  end if;
  insert into onet_rooms(owner_id, name, expires_at)
  values (auth.uid(), btrim(p_name),
          (public.app_setting_json('onet.room_expire_date', '"2027-03-31"'::jsonb) #>> '{}')::date)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.onet_room_rename(p_room uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.onet_require_room(p_room, false);
  if p_name is null or length(btrim(p_name)) = 0 then raise exception 'กรุณาตั้งชื่อห้อง'; end if;
  update onet_rooms set name = btrim(p_name) where id = p_room;
end $$;

create or replace function public.onet_room_list()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.onet_require_user();
  perform public.onet_expire_due();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'status', r.status, 'expires_at', r.expires_at,
      'created_at', r.created_at, 'closed_at', r.closed_at,
      'students', (select count(distinct seat_no) from onet_results x where x.room_id = r.id),
      'sheets', (select count(*) from onet_results x where x.room_id = r.id))
      order by r.status desc, r.created_at desc)
    from onet_rooms r where r.owner_id = auth.uid()), '[]'::jsonb);
end $$;

-- ส่งผลการสแกน 1 แผ่น → ตรวจคะแนนบนเซิร์ฟเวอร์
--   p_answers: อาร์เรย์ยาวเท่าจำนวนข้อ ค่า '1'–'4' / '000'–'999' / null (ไม่ระบาย/ฝนเกิน/อ่านไม่ได้)
--   เลขที่ซ้ำในห้อง+ชุดเดียวกัน และ p_replace = false → ไม่บันทึก คืน status 'duplicate'
create or replace function public.onet_submit(p_room uuid, p_set text, p_seat int, p_answers jsonb,
  p_bubbled_set text default null, p_remarks jsonb default '[]'::jsonb, p_replace boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_n int; v_correct jsonb; v_score numeric; v_ok int; v_old onet_results; v_bubble text;
begin
  perform public.onet_require_room(p_room, true);
  if not public.onet_can_use_set(p_set) then raise exception 'ชุดนี้ยังไม่ได้ปลดล็อก'; end if;
  if p_seat is null or p_seat < 1 or p_seat > 99 then raise exception 'เลขที่ต้องอยู่ระหว่าง 1–99'; end if;
  select count(*) into v_n from onet_set_items where set_code = p_set;
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> v_n then
    raise exception 'จำนวนคำตอบไม่ตรงกับจำนวนข้อ (% ข้อ)', v_n;
  end if;
  if jsonb_typeof(coalesce(p_remarks, '[]'::jsonb)) <> 'array' then raise exception 'remarks ต้องเป็นอาร์เรย์'; end if;

  select * into v_old from onet_results where room_id = p_room and set_code = p_set and seat_no = p_seat;
  if found and not p_replace then
    return jsonb_build_object('status', 'duplicate', 'seat_no', p_seat,
      'existing', jsonb_build_object('score', v_old.score, 'scanned_at', v_old.scanned_at));
  end if;

  select jsonb_agg((p_answers ->> (i.item_no - 1)) is not distinct from i.answer order by i.item_no),
         sum(case when (p_answers ->> (i.item_no - 1)) is not distinct from i.answer then i.points else 0 end),
         count(*) filter (where (p_answers ->> (i.item_no - 1)) is not distinct from i.answer)
    into v_correct, v_score, v_ok
  from onet_set_items i where i.set_code = p_set;

  select bubble_code into v_bubble from onet_sets where code = p_set;
  insert into onet_results(room_id, set_code, seat_no, answers, correct, score, bubbled_set, remarks, scanned_at)
  values (p_room, p_set, p_seat, p_answers, v_correct, v_score, p_bubbled_set, coalesce(p_remarks, '[]'::jsonb), now())
  on conflict (room_id, set_code, seat_no) do update set
    answers = excluded.answers, correct = excluded.correct, score = excluded.score,
    bubbled_set = excluded.bubbled_set, remarks = excluded.remarks, scanned_at = excluded.scanned_at;

  return jsonb_build_object('status', case when v_old.room_id is null then 'saved' else 'replaced' end,
    'seat_no', p_seat, 'score', v_score, 'correct_count', v_ok, 'item_count', v_n, 'correct', v_correct,
    'set_mismatch', p_bubbled_set is distinct from v_bubble);
end $$;

create or replace function public.onet_result_delete(p_room uuid, p_set text, p_seat int)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.onet_require_room(p_room, true);
  delete from onet_results where room_id = p_room and set_code = p_set and seat_no = p_seat;
  if not found then raise exception 'ไม่พบผลของเลขที่ %', p_seat; end if;
end $$;

-- รายงานของห้อง: ข้อมูลชุด (ไม่มีเฉลย) + ผลรายเลขที่ทุกชุด
create or replace function public.onet_report(p_room uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r onet_rooms;
begin
  r := public.onet_require_room(p_room, false);
  return jsonb_build_object(
    'room', jsonb_build_object('id', r.id, 'name', r.name, 'status', r.status, 'expires_at', r.expires_at),
    'sets', coalesce((select jsonb_agg(public.onet_set_detail(s.code) order by s.set_no)
                      from onet_sets s where s.code in (select distinct set_code from onet_results where room_id = p_room)),
                     '[]'::jsonb),
    'results', coalesce((select jsonb_agg(jsonb_build_object(
        'set_code', x.set_code, 'seat_no', x.seat_no, 'answers', x.answers, 'correct', x.correct,
        'score', x.score, 'bubbled_set', x.bubbled_set,
        'set_mismatch', x.bubbled_set is distinct from s.bubble_code,
        'remarks', x.remarks, 'scanned_at', x.scanned_at) order by s.set_no, x.seat_no)
      from onet_results x join onet_sets s on s.code = x.set_code where x.room_id = p_room), '[]'::jsonb));
end $$;

-- ปิดห้อง: รวมสถิติรายข้อ แล้วลบผลรายเลขที่ทั้งหมด (ย้อนกลับไม่ได้ — หน้าเว็บให้ส่งออกก่อน)
create or replace function public.onet_room_close(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.onet_require_room(p_room, false);
  if (select status from onet_rooms where id = p_room) = 'closed' then raise exception 'ห้องนี้ปิดแล้ว'; end if;
  perform public.onet_room_finalize(p_room);
end $$;

create or replace function public.onet_room_delete(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.onet_require_room(p_room, false);
  if exists (select 1 from onet_results where room_id = p_room) then
    raise exception 'ห้องนี้ยังมีผลสอบ กรุณาปิดห้องก่อนลบ';
  end if;
  delete from onet_rooms where id = p_room;
end $$;

-- ---------- ฟังก์ชันผู้ดูแล (owner/admin) ----------
create or replace function public.onet_require_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.app_is_bank_admin() then raise exception 'เฉพาะผู้ดูแลระบบ' using errcode = '42501'; end if;
end $$;

create or replace function public.onet_admin_users(p_query text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.onet_require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'email', u.email, 'display_name', p.display_name, 'school_name', p.school_name,
      'role', p.role, 'created_at', p.created_at,
      'entitled', e.user_id is not null, 'granted_at', e.granted_at, 'note', e.note,
      'rooms', (select count(*) from onet_rooms r where r.owner_id = p.id),
      'sheets', (select count(*) from onet_results x join onet_rooms r on r.id = x.room_id where r.owner_id = p.id))
      order by p.created_at desc)
    from profiles p join auth.users u on u.id = p.id
    left join onet_entitlements e on e.user_id = p.id
    where p_query is null or btrim(p_query) = ''
       or u.email ilike '%' || btrim(p_query) || '%'
       or coalesce(p.display_name, '') ilike '%' || btrim(p_query) || '%'
       or coalesce(p.school_name, '') ilike '%' || btrim(p_query) || '%'), '[]'::jsonb);
end $$;

create or replace function public.onet_admin_grant(p_user uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.onet_require_admin();
  if not exists (select 1 from profiles where id = p_user) then raise exception 'ไม่พบผู้ใช้'; end if;
  insert into onet_entitlements(user_id, granted_by, note) values (p_user, auth.uid(), p_note)
  on conflict (user_id) do update set granted_by = excluded.granted_by, granted_at = now(), note = excluded.note;
end $$;

create or replace function public.onet_admin_revoke(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.onet_require_admin();
  delete from onet_entitlements where user_id = p_user;
end $$;

create or replace function public.onet_admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.onet_require_admin();
  return jsonb_build_object(
    'users', (select count(*) from profiles where role = 'onet'),
    'entitled', (select count(*) from onet_entitlements),
    'open_rooms', (select count(*) from onet_rooms where status = 'open'),
    'sheets', (select count(*) from onet_results),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'set_code', s.set_code, 'item_no', s.item_no, 'n', s.n, 'n_correct', s.n_correct,
        'p', case when s.n > 0 then round(s.n_correct::numeric / s.n, 3) end,
        'answer_counts', s.answer_counts) order by s.set_code, s.item_no)
      from onet_item_stats s), '[]'::jsonb));
end $$;

-- ---------- ไฟล์ชุดติว: Storage bucket 'onet' (ส่วนตัว) ----------
--   ชื่อไฟล์ = '<รหัสชุด>/<ไฟล์>' เช่น 'S03/exam.pdf' · 'common/<ไฟล์>' = ทุกคนที่ล็อกอินอ่านได้
insert into storage.buckets(id, name, public) values ('onet', 'onet', false) on conflict (id) do nothing;

create policy onet_files_read on storage.objects for select to authenticated
  using (bucket_id = 'onet' and (split_part(name, '/', 1) = 'common' or public.onet_can_use_set(split_part(name, '/', 1))));
create policy onet_files_admin on storage.objects for all to authenticated
  using (bucket_id = 'onet' and public.app_is_bank_admin())
  with check (bucket_id = 'onet' and public.app_is_bank_admin());

-- ---------- สิทธิ์เรียกฟังก์ชัน ----------
-- app_pre_request ต้องเรียกได้ทั้ง anon และ authenticated (PostgREST เรียกก่อนทุกคำขอ)
grant execute on function public.app_pre_request() to anon, authenticated;
revoke execute on function public.onet_room_finalize(uuid) from public, anon, authenticated;
revoke execute on function public.tg_block_onet_user() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'app_profile_role()', 'app_is_onet_user()', 'onet_has_entitlement()', 'onet_can_use_set(text)',
    'onet_require_user()', 'onet_require_room(uuid, boolean)', 'onet_require_admin()', 'onet_expire_due()',
    'onet_catalog()', 'onet_set_detail(text)', 'onet_room_create(text)', 'onet_room_rename(uuid, text)',
    'onet_room_list()', 'onet_submit(uuid, text, int, jsonb, text, jsonb, boolean)',
    'onet_result_delete(uuid, text, int)', 'onet_report(uuid)', 'onet_room_close(uuid)', 'onet_room_delete(uuid)',
    'onet_admin_users(text)', 'onet_admin_grant(uuid, text)', 'onet_admin_revoke(uuid)', 'onet_admin_stats()']
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
