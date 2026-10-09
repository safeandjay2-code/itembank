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
