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
