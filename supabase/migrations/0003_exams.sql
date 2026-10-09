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
