-- =====================================================================
-- 0001_core.sql — ระบบติดตาม migration, ตารางอ้างอิง (วิชา ชั้น ตัวชี้วัด
-- ระดับ ประเภทข้อ), ตั้งค่า และโปรไฟล์ผู้ใช้
-- หลักการ: ไม่ hardcode วิชา/ชั้น/ระดับ — ทุกอย่างเป็นข้อมูลในตาราง (SPEC §3.3)
-- =====================================================================
begin;

-- ---------- ระบบติดตาม migration ----------
create table if not exists public.app_migrations (
  version     text primary key,
  description text not null,
  applied_at  timestamptz not null default now()
);

create or replace function public.app_begin_migration(p_version text, p_description text)
returns void language plpgsql as $$
begin
  if exists (select 1 from public.app_migrations where version = p_version) then
    raise exception 'migration % ถูกติดตั้งไปแล้ว (ไม่ต้องรันซ้ำ)', p_version;
  end if;
  insert into public.app_migrations(version, description) values (p_version, p_description);
end $$;

select public.app_begin_migration('0001', 'core: reference tables, settings, profiles');

-- ---------- ฟังก์ชันช่วย ----------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- ตารางอ้างอิงหลักสูตร ----------
create table public.subjects (
  id      text primary key,                -- เช่น 'MATH'
  name_th text not null,
  code_prefix text not null unique,        -- ใช้นำหน้ารหัสข้อ เช่น 'M'
  sort    int  not null default 0
);

create table public.grades (
  id       text primary key,               -- เช่น 'P4'
  name_th  text not null,
  short_th text not null,
  sort     int  not null
);

create table public.strands (
  subject_id text not null references public.subjects(id),
  no         int  not null,
  name_th    text not null,
  primary key (subject_id, no)
);

create table public.standards (
  subject_id text not null references public.subjects(id),
  code       text not null,                -- เช่น 'ค 1.1'
  strand_no  int  not null,
  text       text not null,
  primary key (subject_id, code),
  foreign key (subject_id, strand_no) references public.strands(subject_id, no)
);

create table public.indicators (
  id                 text primary key,     -- เช่น 'MATH-2560-P4-01'
  subject_id         text not null references public.subjects(id),
  curriculum_version text not null,        -- เช่น '2560'
  grade_id           text not null references public.grades(id),
  standard_code      text not null,
  code               text not null,        -- เช่น 'ค 1.1 ป.4/2'
  text               text not null,
  kind               text not null default 'terminal' check (kind in ('terminal','interim')),
  group_no           int  not null,        -- กลุ่มในเอกสารหลักสูตร
  sort               int  not null,        -- ลำดับในหลักสูตร (ใช้เรียงข้อในชุด)
  assessment_note    text,                 -- ข้อสังเกตเรื่องการวัดด้วยปรนัย
  active             boolean not null default true,
  unique (subject_id, curriculum_version, code),
  foreign key (subject_id, standard_code) references public.standards(subject_id, code)
);
create index indicators_grade_idx on public.indicators(subject_id, grade_id, sort);

-- ---------- ระดับ (เป็นข้อมูล ไม่ใช่ค่าคงที่ในโค้ด) ----------
create table public.difficulty_levels (
  id      smallint primary key,            -- 1..n เรียงจากง่ายไปยาก
  key     text not null unique,            -- 'easy','medium','hard','challenge'
  name_th text not null,
  p_lower numeric(4,3) not null,           -- ค่า p ต่ำสุดของระดับ (รวม)
  p_upper numeric(4,3) not null,           -- ค่า p สูงสุดของระดับ
  check (p_lower >= 0 and p_upper <= 1 and p_lower < p_upper)
);

create table public.cognitive_levels (
  id      smallint primary key,
  key     text not null unique,            -- 'remember','understand','apply','analyze'
  name_th text not null
);

-- ---------- ประเภทข้อสอบ (เสียบเพิ่มได้ SPEC §3.6) ----------
create table public.item_types (
  key           text primary key,          -- 'mcq4', ในอนาคต 'numeric'
  name_th       text not null,
  response_kind text not null check (response_kind in ('choice','numeric')),
  option_count  int,                       -- null สำหรับประเภทที่ไม่ใช่ตัวเลือก
  active        boolean not null default true
);

-- ---------- ตั้งค่าระบบ (เกณฑ์ทั้งหมด ปรับได้โดยไม่แก้โค้ด SPEC §3.5) ----------
create table public.app_settings (
  key            text primary key,
  value          jsonb not null,
  description_th text not null,
  updated_at     timestamptz not null default now()
);
create trigger app_settings_updated before update on public.app_settings
  for each row execute function public.tg_set_updated_at();

-- ---------- โปรไฟล์ผู้ใช้ (ผูกกับ Supabase Auth) ----------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  school_name  text,
  role         text not null default 'teacher' check (role in ('owner','admin','teacher')),
  created_at   timestamptz not null default now()
);

-- สร้างโปรไฟล์อัตโนมัติเมื่อมีผู้ใช้ใหม่ (บทบาทเริ่มต้น = teacher; owner ตั้งด้วยมือครั้งเดียว)
create or replace function public.tg_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.tg_handle_new_user();

-- บทบาทของผู้ใช้ปัจจุบัน (ใช้ใน RLS)
create or replace function public.app_current_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.app_is_bank_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('owner','admin') from public.profiles where id = auth.uid()), false)
$$;

-- ห้ามผู้ใช้เปลี่ยนบทบาทตัวเอง (เปลี่ยนได้เฉพาะ owner หรือผ่าน SQL โดยตรง)
create or replace function public.tg_guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and coalesce(public.app_current_role(), '') <> 'owner' then
    raise exception 'ไม่มีสิทธิ์เปลี่ยนบทบาทผู้ใช้';
  end if;
  return new;
end $$;

create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.tg_guard_profile_role();

commit;
-- =====================================================================
-- 0002_bank.sql — คลังข้อสอบ: ข้อสอบ, เวอร์ชันเนื้อหา, สถิติรายรอบ, บันทึกเหตุการณ์
-- หลักการ (SPEC §3.8, §5):
--   * รหัสประจำข้อ (item_code) สร้างครั้งเดียว ไม่เปลี่ยนตลอดอายุ และไม่ฝังระดับ/ชั้น
--   * ระดับความยาก/สถานะ เปลี่ยนได้ และบันทึกประวัติทุกครั้ง
--   * เนื้อหาแยกเป็นเวอร์ชัน — แก้สาระสำคัญ = เวอร์ชันใหม่ สถิติเริ่มนับใหม่
--   * เฉลยแยกคอลัมน์จากเนื้อหา เพื่อควบคุมสิทธิ์แยกได้ในอนาคต
-- =====================================================================
begin;
select public.app_begin_migration('0002', 'item bank: items, versions, stats, events');

create sequence public.item_code_seq start 1;

create table public.items (
  id                 uuid primary key default gen_random_uuid(),
  item_code          text not null unique,
  owner_id           uuid not null default auth.uid() references public.profiles(id),
  subject_id         text not null references public.subjects(id),
  indicator_id       text not null references public.indicators(id),
  item_type          text not null default 'mcq4' references public.item_types(key),
  cognitive_level    smallint not null references public.cognitive_levels(id),
  est_difficulty     smallint not null references public.difficulty_levels(id),
  current_difficulty smallint not null references public.difficulty_levels(id),
  status             text not null default 'draft'
                     check (status in ('draft','reviewed','active','needs_fix','retired')),
  current_version    int  not null default 1,
  no_shuffle         boolean not null default false,  -- ห้ามสลับตัวเลือก
  is_sample          boolean not null default false,  -- ข้อหุ่นสำหรับทดสอบระบบ
  tags               text[] not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index items_cell_idx on public.items(indicator_id, current_difficulty, status);

create table public.item_versions (
  item_id     uuid not null references public.items(id) on delete cascade,
  version     int  not null,
  -- content: { stem, options[], figure (ข้อกำหนดรูป|null), explanation, distractor_rationale[] }
  content     jsonb not null,
  -- answer: mcq4 -> {"choice": 1..4} (ตำแหน่งในลำดับต้นฉบับ); numeric -> {"value": "..."} ในอนาคต
  answer      jsonb not null,
  change_note text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (item_id, version)
);

-- สถิติรายรอบสอบ (ค่ารวมระดับข้อ ไม่ระบุตัวนักเรียน — เก็บถาวรได้)
create table public.item_stat_rounds (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references public.items(id) on delete cascade,
  version        int  not null,
  grade_id       text references public.grades(id),
  source_exam_id uuid,                 -- ไม่ผูก FK: ชุดสอบอาจถูกลบภายหลัง
  n              int  not null check (n > 0),
  n_correct      int  not null check (n_correct >= 0 and n_correct <= n),
  r              numeric(5,3),         -- อำนาจจำแนกของรอบนี้
  option_counts  jsonb not null default '{}'::jsonb,  -- {"1":5,"2":12,"3":3,"4":2,"blank":1,"multi":0}
  recorded_at    timestamptz not null default now()
);
create index item_stat_rounds_item_idx on public.item_stat_rounds(item_id, version);

-- บันทึกเหตุการณ์ของข้อ (สร้าง แก้ไข เปลี่ยนสถานะ ย้ายระดับ ฯลฯ)
create table public.item_events (
  id         bigserial primary key,
  item_id    uuid not null references public.items(id) on delete cascade,
  event_type text not null,            -- 'created','status_changed','difficulty_changed','version_added'
  payload    jsonb not null default '{}'::jsonb,
  actor      uuid default auth.uid(),
  at         timestamptz not null default now()
);
create index item_events_item_idx on public.item_events(item_id, at);

-- ---------- ทริกเกอร์ ----------
-- สร้างรหัสประจำข้อ: <prefix วิชา>-<เลข 6 หลัก> เช่น M-000123
create or replace function public.tg_items_before_insert()
returns trigger language plpgsql as $$
declare v_prefix text;
begin
  select code_prefix into v_prefix from public.subjects where id = new.subject_id;
  if new.item_code is null then
    new.item_code := v_prefix || '-' || lpad(nextval('public.item_code_seq')::text, 6, '0');
  end if;
  if new.current_difficulty is null then
    new.current_difficulty := new.est_difficulty;
  end if;
  return new;
end $$;

create trigger items_before_insert before insert on public.items
  for each row execute function public.tg_items_before_insert();

-- ข้อมูลที่ห้ามเปลี่ยนหลังสร้าง
create or replace function public.tg_items_guard_immutable()
returns trigger language plpgsql as $$
begin
  if new.item_code <> old.item_code then
    raise exception 'รหัสประจำข้อ (item_code) เปลี่ยนไม่ได้';
  end if;
  if new.id <> old.id or new.subject_id <> old.subject_id then
    raise exception 'id และวิชาของข้อเปลี่ยนไม่ได้';
  end if;
  return new;
end $$;

create trigger items_guard_immutable before update on public.items
  for each row execute function public.tg_items_guard_immutable();

create trigger items_updated before update on public.items
  for each row execute function public.tg_set_updated_at();

-- บันทึกประวัติอัตโนมัติ
create or replace function public.tg_items_log_events()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into public.item_events(item_id, event_type, payload)
    values (new.id, 'created', jsonb_build_object('item_code', new.item_code,
            'difficulty', new.current_difficulty, 'status', new.status));
  else
    if new.status is distinct from old.status then
      insert into public.item_events(item_id, event_type, payload)
      values (new.id, 'status_changed', jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if new.current_difficulty is distinct from old.current_difficulty then
      insert into public.item_events(item_id, event_type, payload)
      values (new.id, 'difficulty_changed',
              jsonb_build_object('from', old.current_difficulty, 'to', new.current_difficulty));
    end if;
    if new.current_version is distinct from old.current_version then
      insert into public.item_events(item_id, event_type, payload)
      values (new.id, 'version_changed', jsonb_build_object('from', old.current_version, 'to', new.current_version));
    end if;
  end if;
  return new;
end $$;

create trigger items_log_events after insert or update on public.items
  for each row execute function public.tg_items_log_events();

-- ---------- มุมมอง ----------
-- สถิติสะสมของเวอร์ชันปัจจุบัน (r ถ่วงน้ำหนักด้วย n)
create view public.item_stats with (security_invoker = true) as
select i.id as item_id,
       i.item_code,
       i.current_version as version,
       coalesce(sum(s.n), 0)::int                                   as n,
       coalesce(sum(s.n_correct), 0)::int                           as n_correct,
       case when sum(s.n) > 0 then round(sum(s.n_correct)::numeric / sum(s.n), 3) end as p,
       case when sum(s.n) filter (where s.r is not null) > 0
            then round(sum(s.r * s.n) filter (where s.r is not null)
                       / sum(s.n) filter (where s.r is not null), 3) end      as r
from public.items i
left join public.item_stat_rounds s
       on s.item_id = i.id and s.version = i.current_version
group by i.id, i.item_code, i.current_version;

-- ผังความครบ: จำนวนข้อที่พร้อมใช้ต่อ ตัวชี้วัด × ระดับความยาก
create view public.bank_coverage with (security_invoker = true) as
select ind.id   as indicator_id,
       ind.subject_id,
       ind.grade_id,
       ind.code as indicator_code,
       ind.sort as indicator_sort,
       d.id     as difficulty_id,
       d.key    as difficulty_key,
       count(i.id) filter (where i.status in ('reviewed','active'))::int as ready_count,
       count(i.id) filter (where i.status = 'draft')::int                as draft_count,
       count(i.id) filter (where i.status = 'needs_fix')::int            as needs_fix_count
from public.indicators ind
cross join public.difficulty_levels d
left join public.items i
       on i.indicator_id = ind.id and i.current_difficulty = d.id
where ind.active and ind.kind = 'terminal'
group by ind.id, ind.subject_id, ind.grade_id, ind.code, ind.sort, d.id, d.key;

-- ---------- เครื่องมือดูแล ----------
-- ลบข้อหุ่นทั้งหมด (ใช้เมื่อเริ่มใส่ข้อสอบจริง)
create or replace function public.bank_remove_sample_items()
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not public.app_is_bank_admin() and auth.uid() is not null then
    raise exception 'ไม่มีสิทธิ์';
  end if;
  delete from public.items where is_sample;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

commit;
-- =====================================================================
-- 0003_exams.sql — ชุดข้อสอบ, การจัดชุด, ที่นั่ง, คำตอบรายเลขที่, แบบกระดาษคำตอบ
-- หลักการ (SPEC §6–§10):
--   * ไม่มีชื่อนักเรียนในระบบ ใช้เลขที่เท่านั้น
--   * responses เป็นข้อมูลชั่วคราว ลบเมื่อปิดชุด/หมดอายุ (ฟังก์ชันปิดชุดอยู่เฟส 6)
--   * แบบกระดาษคำตอบมีเวอร์ชัน กระดาษรุ่นเก่ายังตรวจได้ (SPEC §3.7)
-- =====================================================================
begin;
select public.app_begin_migration('0003', 'exams: exams, set layouts, seats, responses, sheet templates');

create table public.answer_sheet_templates (
  version    int primary key,
  name_th    text not null,
  spec       jsonb not null default '{}'::jsonb,   -- ขนาด ตำแหน่งวงกลม มุมอ้างอิง (กำหนดในเฟส 4)
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.exams (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references public.profiles(id),
  title            text not null,
  subject_id       text not null references public.subjects(id),
  grade_id         text not null references public.grades(id),
  item_count       int  not null check (item_count > 0),
  set_count        int  not null default 1 check (set_count between 1 and 10),
  student_count    int  not null default 0 check (student_count >= 0),
  status           text not null default 'draft'
                   check (status in ('draft','open','closed','expired')),
  template_version int references public.answer_sheet_templates(version),
  build_params     jsonb not null default '{}'::jsonb,  -- สิ่งที่ผู้ใช้เลือกตอนสร้าง (ตัวชี้วัด/ระดับ/จำนวน)
  created_at       timestamptz not null default now(),
  opened_at        timestamptz,
  closed_at        timestamptz,
  expires_at       timestamptz
);
create index exams_owner_idx on public.exams(owner_id, created_at desc);

-- ข้อที่อยู่ในชุดข้อสอบ (ทุกชุดใช้ข้อเดียวกัน)
create table public.exam_items (
  exam_id             uuid not null references public.exams(id) on delete cascade,
  item_id             uuid not null references public.items(id),
  item_version        int  not null,
  base_position       int  not null,        -- ลำดับมาตรฐานก่อนสลับ
  indicator_id        text not null references public.indicators(id),
  difficulty_at_build smallint not null references public.difficulty_levels(id),
  is_anchor           boolean not null default false,  -- ข้อยึดค่า
  primary key (exam_id, item_id),
  unique (exam_id, base_position)
);

-- ลำดับข้อและตัวเลือกของแต่ละชุด (ชุด 1..set_count)
create table public.exam_set_items (
  exam_id      uuid not null references public.exams(id) on delete cascade,
  set_no       int  not null check (set_no >= 1),
  position     int  not null check (position >= 1),
  item_id      uuid not null,
  option_order smallint[],                  -- เช่น {3,1,4,2}: ตัวเลือกที่แสดงลำดับ 1 คือตัวเลือกต้นฉบับที่ 3
  primary key (exam_id, set_no, position),
  unique (exam_id, set_no, item_id),
  foreign key (exam_id, item_id) references public.exam_items(exam_id, item_id) on delete cascade
);

-- เลขที่ → ชุด
create table public.exam_seats (
  exam_id uuid not null references public.exams(id) on delete cascade,
  seat_no int  not null check (seat_no >= 1),
  set_no  int  not null check (set_no >= 1),
  primary key (exam_id, seat_no)
);

-- คำตอบรายเลขที่ (ข้อมูลชั่วคราว — ลบเมื่อปิดชุด)
create table public.responses (
  exam_id    uuid not null references public.exams(id) on delete cascade,
  seat_no    int  not null,
  set_no     int  not null,
  answers    jsonb not null,               -- อาร์เรย์ตามตำแหน่งในชุด: 1..4 | null (ไม่ฝน) | "multi"
  score      int,
  flags      jsonb not null default '[]'::jsonb,  -- remark ต่าง ๆ เช่น กำกวม/สงสัยแจกผิดชุด
  source     text not null default 'camera' check (source in ('camera','upload','manual')),
  scanned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (exam_id, seat_no),
  foreign key (exam_id, seat_no) references public.exam_seats(exam_id, seat_no) on delete cascade
);
create trigger responses_updated before update on public.responses
  for each row execute function public.tg_set_updated_at();

-- ห้ามบันทึกคำตอบในชุดที่ปิดแล้ว
create or replace function public.tg_responses_guard_open()
returns trigger language plpgsql as $$
declare v_status text;
begin
  select status into v_status from public.exams where id = new.exam_id;
  if v_status in ('closed','expired') then
    raise exception 'ชุดข้อสอบนี้ปิดแล้ว บันทึกคำตอบเพิ่มไม่ได้';
  end if;
  return new;
end $$;
create trigger responses_guard_open before insert or update on public.responses
  for each row execute function public.tg_responses_guard_open();

commit;
-- =====================================================================
-- 0004_rls.sql — สิทธิ์การเข้าถึง (Row Level Security)
--   * ตารางอ้างอิง/ตั้งค่า: ผู้ล็อกอินอ่านได้, แก้ได้เฉพาะ owner/admin
--   * คลังข้อสอบ: เฉพาะ owner/admin (คลัง = ทรัพย์สินของเจ้าของระบบ SPEC §12)
--   * ชุดข้อสอบและข้อมูลลูก: เฉพาะเจ้าของชุด (หรือ owner/admin)
--   * ผู้ไม่ล็อกอิน (anon): ไม่เห็นอะไรเลย
-- =====================================================================
begin;
select public.app_begin_migration('0004', 'row level security policies');

-- ---------- ตารางอ้างอิง ----------
do $$
declare t text;
begin
  foreach t in array array['subjects','grades','strands','standards','indicators',
                           'difficulty_levels','cognitive_levels','item_types',
                           'app_settings','answer_sheet_templates']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)',
                   t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated
                    using (public.app_is_bank_admin()) with check (public.app_is_bank_admin())',
                   t || '_admin_write', t);
  end loop;
end $$;

alter table public.app_migrations enable row level security;
create policy app_migrations_read on public.app_migrations for select to authenticated using (true);

-- ---------- โปรไฟล์ ----------
alter table public.profiles enable row level security;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.app_is_bank_admin());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() or public.app_current_role() = 'owner')
  with check (id = auth.uid() or public.app_current_role() = 'owner');

-- ---------- คลังข้อสอบ ----------
do $$
declare t text;
begin
  foreach t in array array['items','item_versions','item_stat_rounds','item_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated
                    using (public.app_is_bank_admin()) with check (public.app_is_bank_admin())',
                   t || '_bank_admin', t);
  end loop;
end $$;

-- ---------- ชุดข้อสอบ ----------
alter table public.exams enable row level security;
create policy exams_owner on public.exams for all to authenticated
  using (owner_id = auth.uid() or public.app_is_bank_admin())
  with check (owner_id = auth.uid() or public.app_is_bank_admin());

create or replace function public.app_owns_exam(p_exam uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.exams e
                 where e.id = p_exam
                   and (e.owner_id = auth.uid() or public.app_is_bank_admin()))
$$;

do $$
declare t text;
begin
  foreach t in array array['exam_items','exam_set_items','exam_seats','responses']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated
                    using (public.app_owns_exam(exam_id)) with check (public.app_owns_exam(exam_id))',
                   t || '_exam_owner', t);
  end loop;
end $$;

commit;
-- สร้างอัตโนมัติจาก data/*.json ด้วย scripts/build-seed.mjs — ห้ามแก้ไฟล์นี้ด้วยมือ
begin;
select public.app_begin_migration('S001', 'seed: reference data + math 2560 terminal indicators P4-P6');
insert into public.difficulty_levels(id,key,name_th,p_lower,p_upper) values (1,'easy','ง่าย',0.8,1);
insert into public.difficulty_levels(id,key,name_th,p_lower,p_upper) values (2,'medium','ปานกลาง',0.5,0.8);
insert into public.difficulty_levels(id,key,name_th,p_lower,p_upper) values (3,'hard','ยาก',0.25,0.5);
insert into public.difficulty_levels(id,key,name_th,p_lower,p_upper) values (4,'challenge','ท้าทาย',0,0.25);
insert into public.cognitive_levels(id,key,name_th) values (1,'remember','จำ');
insert into public.cognitive_levels(id,key,name_th) values (2,'understand','เข้าใจ');
insert into public.cognitive_levels(id,key,name_th) values (3,'apply','นำไปใช้');
insert into public.cognitive_levels(id,key,name_th) values (4,'analyze','วิเคราะห์');
insert into public.item_types(key,name_th,response_kind,option_count,active) values ('mcq4','ปรนัย 4 ตัวเลือก','choice',4,true);
insert into public.item_types(key,name_th,response_kind,option_count,active) values ('numeric','เติมคำตอบเป็นตัวเลข','numeric',null,false);
insert into public.app_settings(key,value,description_th) values ('bank.items_per_level_target','20'::jsonb,'เป้าจำนวนข้อต่อตัวชี้วัดต่อระดับความยาก');
insert into public.app_settings(key,value,description_th) values ('assembly.prefer_low_n','true'::jsonb,'เลือกข้อที่ใช้น้อย (n น้อย) ออกไปก่อน');
insert into public.app_settings(key,value,description_th) values ('assembly.anchor_min_n','50'::jsonb,'n ขั้นต่ำที่ถือว่าเป็นข้อยึดค่า');
insert into public.app_settings(key,value,description_th) values ('assembly.anchor_ratio','{"min":0.2,"max":0.3}'::jsonb,'สัดส่วนข้อยึดค่าในแต่ละชุด');
insert into public.app_settings(key,value,description_th) values ('assembly.max_sets','10'::jsonb,'จำนวนชุดสูงสุดต่อการสร้างข้อสอบ 1 ครั้ง');
insert into public.app_settings(key,value,description_th) values ('calibration.min_n_to_move','50'::jsonb,'n ขั้นต่ำก่อนย้ายระดับความยาก');
insert into public.app_settings(key,value,description_th) values ('calibration.buffer','0.05'::jsonb,'ช่วงกันชนรอบเส้นแบ่งค่า p');
insert into public.app_settings(key,value,description_th) values ('calibration.r_flag_below','0.2'::jsonb,'ค่า r ต่ำกว่านี้ ตั้งสถานะ ''ต้องแก้''');
insert into public.app_settings(key,value,description_th) values ('privacy.exam_expiry_days','60'::jsonb,'ลบข้อมูลรายเลขที่อัตโนมัติเมื่อไม่ปิดชุดภายในกี่วัน');
insert into public.app_settings(key,value,description_th) values ('report.indicator_pass_ratio','0.5'::jsonb,'สัดส่วนข้อที่ต้องตอบถูกจึงถือว่าผ่านตัวชี้วัด');
insert into public.app_settings(key,value,description_th) values ('print.page_size','"A4"'::jsonb,'ขนาดกระดาษแบบทดสอบ (ห้าม Letter)');
insert into public.app_settings(key,value,description_th) values ('print.font','"TH Sarabun New"'::jsonb,'ฟอนต์เอกสาร');
insert into public.app_settings(key,value,description_th) values ('print.figure_note','"รูปอาจไม่ได้วาดตามมาตราส่วน ให้ใช้ขนาดที่กำหนดให้"'::jsonb,'หมายเหตุตัวหนาใต้รูปเรขาคณิต');
insert into public.answer_sheet_templates(version,name_th,spec) values (1,'A5 ปรนัย 4 ตัวเลือก รุ่นที่ 1','{"paper":"A5","per_a4":2,"choices":4,"corner_markers":true,"qr":true}'::jsonb);
insert into public.subjects(id,name_th,code_prefix,sort) values ('MATH','คณิตศาสตร์','M',1);
insert into public.grades(id,name_th,short_th,sort) values ('P4','ประถมศึกษาปีที่ 4','ป.4',4) on conflict (id) do nothing;
insert into public.grades(id,name_th,short_th,sort) values ('P5','ประถมศึกษาปีที่ 5','ป.5',5) on conflict (id) do nothing;
insert into public.grades(id,name_th,short_th,sort) values ('P6','ประถมศึกษาปีที่ 6','ป.6',6) on conflict (id) do nothing;
insert into public.strands(subject_id,no,name_th) values ('MATH',1,'จำนวนและพีชคณิต');
insert into public.strands(subject_id,no,name_th) values ('MATH',2,'การวัดและเรขาคณิต');
insert into public.strands(subject_id,no,name_th) values ('MATH',3,'สถิติและความน่าจะเป็น');
insert into public.standards(subject_id,code,strand_no,text) values ('MATH','ค 1.1',1,'เข้าใจความหลากหลายของการแสดงจำนวน ระบบจำนวน การดำเนินการของจำนวน ผลที่เกิดขึ้นจากการดำเนินการ สมบัติของการดำเนินการ และนำไปใช้');
insert into public.standards(subject_id,code,strand_no,text) values ('MATH','ค 1.2',1,'เข้าใจและวิเคราะห์แบบรูป ความสัมพันธ์ ฟังก์ชัน ลำดับและอนุกรม และนำไปใช้');
insert into public.standards(subject_id,code,strand_no,text) values ('MATH','ค 2.1',2,'เข้าใจพื้นฐานเกี่ยวกับการวัด วัดและคาดคะเนขนาดของสิ่งที่ต้องการวัด และนำไปใช้');
insert into public.standards(subject_id,code,strand_no,text) values ('MATH','ค 2.2',2,'เข้าใจและวิเคราะห์รูปเรขาคณิต สมบัติของรูปเรขาคณิต ความสัมพันธ์ระหว่างรูปเรขาคณิต และทฤษฎีบททางเรขาคณิต และนำไปใช้');
insert into public.standards(subject_id,code,strand_no,text) values ('MATH','ค 3.1',3,'เข้าใจกระบวนการทางสถิติ และใช้ความรู้ทางสถิติในการแก้ปัญหา');
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P4-01','MATH','2560','P4','ค 1.1','ค 1.1 ป.4/2','เปรียบเทียบและเรียงลำดับจำนวนนับที่มากกว่า 100,000 จากสถานการณ์ต่าง ๆ','terminal',1,1,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P4-02','MATH','2560','P4','ค 1.1','ค 1.1 ป.4/11','แสดงวิธีหาคำตอบของโจทย์ปัญหา 2 ขั้นตอน ของจำนวนนับที่มากกว่า 100,000 และ 0','terminal',1,2,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P4-03','MATH','2560','P4','ค 1.1','ค 1.1 ป.4/4','เปรียบเทียบ เรียงลำดับเศษส่วนและจำนวนคละที่ตัวส่วนตัวหนึ่งเป็นพหุคูณของอีกตัวหนึ่ง','terminal',2,3,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P4-04','MATH','2560','P4','ค 1.1','ค 1.1 ป.4/14','แสดงวิธีหาคำตอบของโจทย์ปัญหาการบวกและโจทย์ปัญหาการลบเศษส่วนและจำนวนคละที่ตัวส่วนตัวหนึ่งเป็นพหุคูณของอีกตัวหนึ่ง','terminal',2,4,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P4-05','MATH','2560','P4','ค 1.1','ค 1.1 ป.4/6','เปรียบเทียบและเรียงลำดับทศนิยมไม่เกิน 3 ตำแหน่งจากสถานการณ์ต่าง ๆ','terminal',3,5,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P4-06','MATH','2560','P4','ค 1.1','ค 1.1 ป.4/16','แสดงวิธีหาคำตอบของโจทย์ปัญหาการบวก การลบ 2 ขั้นตอนของทศนิยมไม่เกิน 3 ตำแหน่ง','terminal',3,6,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P4-07','MATH','2560','P4','ค 2.1','ค 2.1 ป.4/1','แสดงวิธีหาคำตอบของโจทย์ปัญหาเกี่ยวกับเวลา','terminal',4,7,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P4-08','MATH','2560','P4','ค 2.1','ค 2.1 ป.4/3','แสดงวิธีหาคำตอบของโจทย์ปัญหาเกี่ยวกับความยาวรอบรูปและพื้นที่ของรูปสี่เหลี่ยมมุมฉาก','terminal',5,8,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P4-09','MATH','2560','P4','ค 2.2','ค 2.2 ป.4/2','สร้างรูปสี่เหลี่ยมมุมฉากเมื่อกำหนดความยาวของด้าน','terminal',5,9,'เป็นทักษะการสร้าง ปรนัยวัดได้บางส่วน (เช่น ขั้นตอน/ผลการสร้าง)');
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P4-10','MATH','2560','P4','ค 3.1','ค 3.1 ป.4/1','ใช้ข้อมูลจากแผนภูมิแท่ง ตารางสองทางในการหาคำตอบของโจทย์ปัญหา','terminal',6,10,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P5-01','MATH','2560','P5','ค 1.1','ค 1.1 ป.5/8','แสดงวิธีหาคำตอบของโจทย์ปัญหาการบวก การลบ การคูณ การหารทศนิยม 2 ขั้นตอน','terminal',1,1,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P5-02','MATH','2560','P5','ค 1.1','ค 1.1 ป.5/2','แสดงวิธีหาคำตอบของโจทย์ปัญหา โดยใช้บัญญัติไตรยางศ์','terminal',2,2,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P5-03','MATH','2560','P5','ค 1.1','ค 1.1 ป.5/9','แสดงวิธีหาคำตอบของโจทย์ปัญหาร้อยละไม่เกิน 2 ขั้นตอน','terminal',2,3,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P5-04','MATH','2560','P5','ค 1.1','ค 1.1 ป.5/5','แสดงวิธีหาคำตอบของโจทย์ปัญหาการบวก การลบ การคูณ การหาร เศษส่วน 2 ขั้นตอน','terminal',3,4,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P5-05','MATH','2560','P5','ค 2.1','ค 2.1 ป.5/3','แสดงวิธีหาคำตอบของโจทย์ปัญหาเกี่ยวกับปริมาตรของทรงสี่เหลี่ยมมุมฉากและความจุของภาชนะทรงสี่เหลี่ยมมุมฉาก','terminal',4,5,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P5-06','MATH','2560','P5','ค 2.2','ค 2.2 ป.5/4','บอกลักษณะของปริซึม','terminal',4,6,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P5-07','MATH','2560','P5','ค 2.1','ค 2.1 ป.5/4','แสดงวิธีหาคำตอบของโจทย์ปัญหาเกี่ยวกับความยาวรอบรูปของรูปสี่เหลี่ยมและพื้นที่ของรูปสี่เหลี่ยมด้านขนานและรูปสี่เหลี่ยมขนมเปียกปูน','terminal',5,7,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P5-08','MATH','2560','P5','ค 2.2','ค 2.2 ป.5/3','สร้างรูปสี่เหลี่ยมชนิดต่าง ๆ เมื่อกำหนดความยาวของด้านและขนาดของมุมหรือเมื่อกำหนดความยาวของเส้นทแยงมุม','terminal',5,8,'เป็นทักษะการสร้าง ปรนัยวัดได้บางส่วน');
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P5-09','MATH','2560','P5','ค 3.1','ค 3.1 ป.5/1','ใช้ข้อมูลจากกราฟเส้นในการหาคำตอบของโจทย์ปัญหา','terminal',6,9,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P5-10','MATH','2560','P5','ค 3.1','ค 3.1 ป.5/2','เขียนแผนภูมิแท่งจากข้อมูลที่เป็นจำนวนนับ','terminal',6,10,'เป็นทักษะการเขียน ปรนัยวัดได้บางส่วน (เช่น เลือกแผนภูมิที่ถูกต้อง)');
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P6-01','MATH','2560','P6','ค 1.1','ค 1.1 ป.6/1','เปรียบเทียบ เรียงลำดับเศษส่วนและจำนวนคละจากสถานการณ์ต่าง ๆ','terminal',1,1,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P6-02','MATH','2560','P6','ค 1.1','ค 1.1 ป.6/8','แสดงวิธีหาคำตอบของโจทย์ปัญหาเศษส่วนและจำนวนคละ 2 – 3 ขั้นตอน','terminal',1,2,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P6-03','MATH','2560','P6','ค 1.1','ค 1.1 ป.6/11','แสดงวิธีหาคำตอบของโจทย์ปัญหาอัตราส่วน','terminal',2,3,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P6-04','MATH','2560','P6','ค 1.1','ค 1.1 ป.6/6','แสดงวิธีหาคำตอบของโจทย์ปัญหา โดยใช้ความรู้เกี่ยวกับ ห.ร.ม. และ ค.ร.น.','terminal',3,4,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P6-05','MATH','2560','P6','ค 1.1','ค 1.1 ป.6/10','แสดงวิธีหาคำตอบของโจทย์ปัญหาการบวก การลบ การคูณ การหารทศนิยม 3 ขั้นตอน','terminal',4,5,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P6-06','MATH','2560','P6','ค 1.1','ค 1.1 ป.6/12','แสดงวิธีหาคำตอบของโจทย์ปัญหาร้อยละ 2 – 3 ขั้นตอน','terminal',5,6,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P6-07','MATH','2560','P6','ค 1.2','ค 1.2 ป.6/1','แสดงวิธีคิดและหาคำตอบของปัญหาเกี่ยวกับแบบรูป','terminal',6,7,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P6-08','MATH','2560','P6','ค 2.1','ค 2.1 ป.6/1','แสดงวิธีหาคำตอบของโจทย์ปัญหาเกี่ยวกับปริมาตรของรูปเรขาคณิตสามมิติที่ประกอบด้วยทรงสี่เหลี่ยมมุมฉาก','terminal',7,8,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P6-09','MATH','2560','P6','ค 2.1','ค 2.1 ป.6/2','แสดงวิธีหาคำตอบของโจทย์ปัญหาเกี่ยวกับความยาวรอบรูปและพื้นที่ของรูปหลายเหลี่ยม','terminal',8,9,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P6-10','MATH','2560','P6','ค 2.2','ค 2.2 ป.6/2','สร้างรูปสามเหลี่ยมเมื่อกำหนดความยาวของด้านและขนาดของมุม','terminal',8,10,'เป็นทักษะการสร้าง ปรนัยวัดได้บางส่วน');
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P6-11','MATH','2560','P6','ค 2.1','ค 2.1 ป.6/3','แสดงวิธีหาคำตอบของโจทย์ปัญหาเกี่ยวกับความยาวรอบรูปและพื้นที่ของวงกลม','terminal',9,11,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P6-12','MATH','2560','P6','ค 2.2','ค 2.2 ป.6/3','บอกลักษณะของรูปเรขาคณิตสามมิติชนิดต่าง ๆ','terminal',10,12,null);
insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values ('MATH-2560-P6-13','MATH','2560','P6','ค 3.1','ค 3.1 ป.6/1','ใช้ข้อมูลจากแผนภูมิรูปวงกลมในการหาคำตอบของโจทย์ปัญหา','terminal',11,13,null);
commit;
