-- =====================================================================
-- 0011_gradebook.sql — One Stop เฟส 1: ฐานข้อมูลสมุดคะแนน (โมดูล gradebook, ตาราง gb_*)
-- อ้างอิง SPEC-OneStop.md §3–§7 และ SPEC.md §17
--   * gb_classrooms     : ห้องเรียน/เทอม (เจ้าของ, ปีการศึกษา, ภาคเรียน, จำนวนนักเรียน = เลขที่ ไม่มีชื่อ, ตั้งค่าการคิดคะแนน)
--   * gb_columns        : ช่องคะแนน — ตัวชี้วัด / ปลายภาค / ช่องอื่น (ห้อง E) · คะแนนเต็มที่ครูตั้ง (ว่างได้ = ยังไม่ตั้ง)
--                         ไม่บังคับรวม 100 · เรียงตามแผนการสอน (sort) · scale เผื่อห้อง F (ประเมินระดับ)
--   * exams.purpose     : ประเภทการสอบ collect (เก็บคะแนน) / final (ปลายภาค) / practice (ฝึก — ค่าเริ่มต้น ชุดเดิมทั้งหมด)
--     exams.classroom_id, exams.retake_of (สอบซ่อม/สอบซ้ำของชุดไหน)
--   * gb_attempts       : คะแนนจริงรายเลขที่ × ตัวชี้วัด ของแต่ละชุด (ระบบเขียนเองจากผลตรวจ — ครูแก้ตรงไม่ได้)
--                         อยู่ต่อหลังปิดชุด จนกว่าจะปิดเทอม
--   * gb_overrides      : คะแนนที่ครูปรับ (ปรับให้ผ่าน / แก้เอง) เก็บแยก — คะแนนจริงไม่หาย
--   * gb_retake_choices : ครูเลือกเองว่าสอบครั้งไหนนับ (เมื่อตั้งวิธีนับสอบซ่อม = manual)
--   * gb_sheet          : คำนวณสมุดคะแนนทั้งห้อง (คะแนนจริง/ที่ปรับ/ที่ปัดแล้ว + ขาดสอบ + ตัวชี้วัดที่ยังไม่เก็บ)
--   * gb_classroom_close: ปิดเทอม = ปิดชุดที่ยังเปิด (สถิติเข้าคลัง) → ลบข้อมูลรายเลขที่ทั้งหมดของห้อง เหลือค่ารวมระดับห้อง
-- เปลี่ยนกติกาเดิม (SPEC.md §17.2): ชุดที่ผูกห้อง (เก็บคะแนน/ปลายภาค) ไม่หมดอายุ 60 วัน · ปิดชุดแล้วคะแนนรายเลขที่ยังอยู่ใน
--   gb_attempts จนปิดเทอม · ชุดฝึก/ชุดเดิมที่ไม่ผูกห้อง ใช้กติกาเดิมทุกอย่าง
-- =====================================================================
begin;
select public.app_begin_migration('0011', 'gradebook: classrooms/terms, score columns, exam purpose, real vs adjusted scores, term close');

-- ---------- ค่าเริ่มต้น (ปรับได้โดยไม่แก้โค้ด) ----------
insert into public.app_settings(key, value, description_th) values
  ('gradebook.default_indicator_total', '70'::jsonb, 'คะแนนรวมตัวชี้วัดเริ่มต้นของห้องใหม่ (แบ่งให้ตัวชี้วัด — ไม่บังคับรวม 100)'),
  ('gradebook.default_final', '30'::jsonb, 'คะแนนเต็มสอบปลายภาคเริ่มต้นของห้องใหม่'),
  ('gradebook.rounding', '"int"'::jsonb, 'การปัดคะแนนในสมุดคะแนน: int = จำนวนเต็มปัดครึ่งขึ้น, 1dp = ทศนิยม 1 ตำแหน่ง'),
  ('gradebook.aggregation', '"sum"'::jsonb, 'รวมคะแนนตัวชี้วัดที่สอบหลายครั้ง: sum = บวกตรง (คะแนนดิบรวม/เต็มรวม), mean = เฉลี่ยแต่ละครั้งเท่ากัน'),
  ('gradebook.retake_policy', '"max"'::jsonb, 'สอบซ่อม/สอบซ้ำ นับครั้งไหน: max = สูงสุด, latest = ล่าสุด, mean = เฉลี่ย, manual = ครูเลือกเอง'),
  ('gradebook.absent_policy', '"zero"'::jsonb, 'ขาดสอบ: zero = นับ 0 (ขึ้นเตือน "ขาดสอบ"), skip = ไม่นับครั้งนั้น'),
  ('gradebook.show_other_columns', 'false'::jsonb, 'แสดงช่องคะแนนอื่น (เข้าเรียน/ส่งงาน/งานกลุ่ม) — ซ่อนไว้เป็นค่าเริ่มต้น'),
  ('gradebook.max_students', '60'::jsonb, 'จำนวนนักเรียน (เลขที่) สูงสุดต่อห้อง')
on conflict (key) do nothing;

create or replace function public.app_setting_json(p_key text, p_default jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from app_settings where key = p_key), p_default)
$$;

-- ---------- ห้องเรียน/เทอม ----------
create table public.gb_classrooms (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references public.profiles(id),
  subject_id     text not null default 'MATH' references public.subjects(id),
  grade_id       text not null references public.grades(id),
  academic_year  int  not null check (academic_year between 2500 and 2700),
  term           smallint not null check (term between 1 and 3),
  name           text not null check (length(btrim(name)) between 1 and 60),   -- เช่น 'ป.5/1'
  student_count  int  not null check (student_count >= 1),
  settings       jsonb not null default '{}'::jsonb,   -- ทับค่าเริ่มต้น gradebook.* เฉพาะห้องนี้
  status         text not null default 'open' check (status in ('open', 'closed')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  closed_at      timestamptz,
  closed_summary jsonb                                 -- หลังปิดเทอม: ค่ารวมระดับห้องเท่านั้น ไม่มีเลขที่
);
create unique index gb_classrooms_unique_open on public.gb_classrooms(owner_id, academic_year, term, lower(btrim(name))) where status = 'open';
create index gb_classrooms_owner_idx on public.gb_classrooms(owner_id, academic_year desc, term desc);
create trigger gb_classrooms_updated before update on public.gb_classrooms
  for each row execute function public.tg_set_updated_at();

-- ตรวจค่าตั้งค่าของห้อง (คีย์ที่ไม่รู้จัก/ค่าไม่ถูกต้อง = ปฏิเสธ)
create or replace function public.gb_validate_settings(p jsonb)
returns void language plpgsql immutable as $$
declare k text; v jsonb;
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'ตั้งค่าห้องต้องเป็น object'; end if;
  for k, v in select * from jsonb_each(p) loop
    case k
      when 'rounding' then if v not in ('"int"', '"1dp"') then raise exception 'การปัดคะแนนต้องเป็น int หรือ 1dp'; end if;
      when 'aggregation' then if v not in ('"sum"', '"mean"') then raise exception 'วิธีรวมคะแนนต้องเป็น sum หรือ mean'; end if;
      when 'retake_policy' then if v not in ('"max"', '"latest"', '"mean"', '"manual"') then raise exception 'วิธีนับสอบซ่อมต้องเป็น max, latest, mean หรือ manual'; end if;
      when 'absent_policy' then if v not in ('"zero"', '"skip"') then raise exception 'วิธีนับขาดสอบต้องเป็น zero หรือ skip'; end if;
      when 'show_other_columns' then if jsonb_typeof(v) <> 'boolean' then raise exception 'show_other_columns ต้องเป็น true/false'; end if;
      else raise exception 'ไม่รู้จักการตั้งค่า "%"', k;
    end case;
  end loop;
end $$;

create or replace function public.tg_gb_classrooms_guard()
returns trigger language plpgsql as $$
declare v_max int := public.app_setting_num('gradebook.max_students', 60)::int;
begin
  perform public.gb_validate_settings(new.settings);
  if new.student_count > v_max then raise exception 'จำนวนนักเรียนต้องไม่เกิน % คน', v_max; end if;
  if tg_op = 'UPDATE' and old.status = 'closed' and new.status = 'closed'
     and (new.settings, new.student_count, new.grade_id, new.subject_id) is distinct from (old.settings, old.student_count, old.grade_id, old.subject_id) then
    raise exception 'ห้องนี้ปิดเทอมแล้ว แก้ไขไม่ได้';
  end if;
  if tg_op = 'UPDATE' and old.status = 'closed' and new.status = 'open' then
    raise exception 'ห้องที่ปิดเทอมแล้วเปิดใหม่ไม่ได้';
  end if;
  return new;
end $$;
create trigger gb_classrooms_guard before insert or update on public.gb_classrooms
  for each row execute function public.tg_gb_classrooms_guard();

-- ค่าตั้งค่าจริงของห้อง = ค่าของห้อง หรือค่าเริ่มต้นระบบ
create or replace function public.gb_setting(p_settings jsonb, p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(p_settings -> p_key, public.app_setting_json('gradebook.' || p_key, null))
$$;

create or replace function public.app_owns_classroom(p_classroom uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.gb_classrooms c
                 where c.id = p_classroom and (c.owner_id = auth.uid() or public.app_is_bank_admin()))
$$;

-- ---------- ช่องคะแนน ----------
create table public.gb_columns (
  id           bigint generated always as identity primary key,
  classroom_id uuid not null references public.gb_classrooms(id) on delete cascade,
  kind         text not null check (kind in ('indicator', 'final', 'other')),
  indicator_id text references public.indicators(id),
  label        text,                                   -- ชื่อช่อง (จำเป็นสำหรับ other)
  max_score    numeric(6,2) check (max_score is null or max_score >= 0),   -- null = ยังไม่ตั้งคะแนน
  scale        text not null default 'number' check (scale in ('number')),  -- ห้อง F: เพิ่ม 'level' ภายหลังด้วย migration
  sort         int  not null default 0,
  created_at   timestamptz not null default now(),
  check ((kind = 'indicator') = (indicator_id is not null)),
  check (kind <> 'other' or length(btrim(coalesce(label, ''))) > 0)
);
create unique index gb_columns_one_indicator on public.gb_columns(classroom_id, indicator_id) where kind = 'indicator';
create unique index gb_columns_one_final on public.gb_columns(classroom_id) where kind = 'final';
create index gb_columns_classroom_idx on public.gb_columns(classroom_id, sort);

-- ---------- ประเภทการสอบ + ผูกห้อง + สอบซ่อม ----------
alter table public.exams add column purpose text not null default 'practice' check (purpose in ('collect', 'final', 'practice'));
alter table public.exams add column classroom_id uuid references public.gb_classrooms(id) on delete set null;
alter table public.exams add column retake_of uuid references public.exams(id) on delete set null;
alter table public.exams add constraint exams_retake_not_self check (retake_of is null or retake_of <> id);
create index exams_classroom_idx on public.exams(classroom_id) where classroom_id is not null;
create index exams_retake_idx on public.exams(retake_of) where retake_of is not null;

-- ---------- คะแนนจริงรายเลขที่ × ตัวชี้วัด ----------
create table public.gb_attempts (
  exam_id      uuid not null references public.exams(id) on delete cascade,
  seat_no      int  not null check (seat_no >= 1),
  indicator_id text not null references public.indicators(id),
  correct      int  not null check (correct >= 0),
  total        int  not null check (total >= 1 and correct <= total),
  updated_at   timestamptz not null default now(),
  primary key (exam_id, seat_no, indicator_id)
);

-- ---------- คะแนนที่ครูปรับ ----------
create table public.gb_overrides (
  column_id  bigint not null references public.gb_columns(id) on delete cascade,
  seat_no    int  not null check (seat_no >= 1),
  score      numeric(6,2) not null check (score >= 0),
  reason     text not null default 'manual' check (reason in ('pass', 'manual')),
  updated_at timestamptz not null default now(),
  primary key (column_id, seat_no)
);

-- ---------- ครูเลือกครั้งที่นับ (retake_policy = manual) ----------
create table public.gb_retake_choices (
  root_exam_id   uuid not null references public.exams(id) on delete cascade,
  seat_no        int  not null check (seat_no >= 1),
  chosen_exam_id uuid not null references public.exams(id) on delete cascade,
  updated_at     timestamptz not null default now(),
  primary key (root_exam_id, seat_no)
);

-- ---------- สิทธิ์: อ่านได้เฉพาะเจ้าของ (หรือ owner/admin) · เขียนผ่านฟังก์ชันเท่านั้น ----------
alter table public.gb_classrooms enable row level security;
alter table public.gb_columns enable row level security;
alter table public.gb_attempts enable row level security;
alter table public.gb_overrides enable row level security;
alter table public.gb_retake_choices enable row level security;
create policy gb_classrooms_read on public.gb_classrooms for select to authenticated
  using (owner_id = auth.uid() or public.app_is_bank_admin());
create policy gb_columns_read on public.gb_columns for select to authenticated
  using (public.app_owns_classroom(classroom_id));
create policy gb_attempts_read on public.gb_attempts for select to authenticated
  using (public.app_owns_exam(exam_id));
create policy gb_overrides_read on public.gb_overrides for select to authenticated
  using (exists (select 1 from public.gb_columns c where c.id = column_id and public.app_owns_classroom(c.classroom_id)));
create policy gb_retake_choices_read on public.gb_retake_choices for select to authenticated
  using (public.app_owns_exam(root_exam_id));

-- =====================================================================
-- คะแนนจริงจากผลตรวจ → gb_attempts (เฉพาะชุดที่ผูกห้อง และเป็นเก็บคะแนน/ปลายภาค)
-- กฎตรวจถูกผิดเดียวกับ analysis_answers (0009)
-- =====================================================================
create or replace function public.gb_refresh_attempts(p_exam uuid, p_seat int)
returns void language plpgsql security definer set search_path = public as $$
declare e exams%rowtype;
begin
  select * into e from exams where id = p_exam;
  delete from gb_attempts where exam_id = p_exam and seat_no = p_seat;
  if e.classroom_id is null or e.purpose not in ('collect', 'final') then return; end if;
  insert into gb_attempts(exam_id, seat_no, indicator_id, correct, total)
  select r.exam_id, r.seat_no, x.indicator_id,
         count(*) filter (where jsonb_typeof(j.v) = 'number' and s.option_order[(j.v)::int] = (v.answer->>'choice')::smallint)::int,
         count(*)::int
  from responses r
  join exam_set_items s on s.exam_id = r.exam_id and s.set_no = r.set_no
  join exam_items x on x.exam_id = r.exam_id and x.item_id = s.item_id
  join item_versions v on v.item_id = s.item_id and v.version = x.item_version
  cross join lateral (select r.answers -> (s.position - 1) as v) j
  where r.exam_id = p_exam and r.seat_no = p_seat
  group by r.exam_id, r.seat_no, x.indicator_id;
end $$;

create or replace function public.tg_responses_gradebook()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if tg_op = 'DELETE' then
    -- ปิดชุด/หมดอายุ ลบคำตอบแต่คะแนนในสมุดคะแนนอยู่ต่อจนปิดเทอม · ลบผลตรวจระหว่างสอบ (ตรวจผิดแผ่น) = ลบคะแนนเลขที่นั้นด้วย
    select status into v_status from exams where id = old.exam_id;
    if v_status is null or v_status not in ('closed', 'expired') then
      delete from gb_attempts where exam_id = old.exam_id and seat_no = old.seat_no;
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.seat_no <> old.seat_no then
    perform public.gb_refresh_attempts(old.exam_id, old.seat_no);
  end if;
  perform public.gb_refresh_attempts(new.exam_id, new.seat_no);
  return new;
end $$;
create trigger responses_gradebook after insert or update or delete on public.responses
  for each row execute function public.tg_responses_gradebook();

-- ห้ามเปลี่ยนห้อง/ประเภท/สอบซ่อมของชุดที่มีผลตรวจหรือคะแนนแล้ว (ยกเลิกผูกห้อง = ลบคะแนนในสมุดของชุดนั้น)
create or replace function public.tg_exams_gradebook_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_has boolean;
begin
  if (new.classroom_id, new.purpose, new.retake_of) is not distinct from (old.classroom_id, old.purpose, old.retake_of) then
    return new;
  end if;
  v_has := exists (select 1 from responses where exam_id = new.id) or exists (select 1 from gb_attempts where exam_id = new.id);
  if v_has and (new.purpose is distinct from old.purpose
                or (new.classroom_id is not null and new.classroom_id is distinct from old.classroom_id)
                or (new.retake_of is not null and new.retake_of is distinct from old.retake_of)) then
    raise exception 'ชุดข้อสอบนี้มีผลตรวจแล้ว เปลี่ยนห้อง/ประเภทการสอบ/สอบซ่อมไม่ได้';
  end if;
  if new.classroom_id is null and old.classroom_id is not null then
    delete from gb_attempts where exam_id = new.id;
    delete from gb_retake_choices where root_exam_id = new.id or chosen_exam_id = new.id;
  end if;
  return new;
end $$;
create trigger exams_gradebook_guard before update of classroom_id, purpose, retake_of on public.exams
  for each row execute function public.tg_exams_gradebook_guard();

-- ชุดที่ผูกห้องไม่หมดอายุ 60 วัน (ข้อมูลอยู่จนปิดเทอม) — ชุดอื่นเหมือนเดิม
create or replace function public.tg_exams_expiry()
returns trigger language plpgsql as $$
begin
  if new.classroom_id is not null then
    new.expires_at := null;
  elsif new.status = 'open' and new.expires_at is null then
    new.expires_at := coalesce(new.opened_at, now()) + make_interval(days => public.app_setting_num('privacy.exam_expiry_days', 60)::int);
  end if;
  return new;
end $$;
drop trigger exams_expiry on public.exams;
create trigger exams_expiry before insert or update of status, classroom_id on public.exams
  for each row execute function public.tg_exams_expiry();

-- ปิดชุด (เหมือน 0009) แต่เปลี่ยนสถานะก่อนลบคำตอบ — ให้คะแนนในสมุดคะแนนอยู่ต่อ
create or replace function public.exam_finalize(p_exam uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e exams%rowtype; v_stats jsonb; v_summary jsonb; v_rows int; v_deleted int;
begin
  if p_status not in ('closed', 'expired') then raise exception 'สถานะปิดไม่ถูกต้อง'; end if;
  select * into e from exams where id = p_exam for update;
  if not found then raise exception 'ไม่พบชุดข้อสอบ'; end if;
  if e.status in ('closed', 'expired') then raise exception 'ชุดข้อสอบนี้ปิดแล้ว'; end if;
  v_stats := public.analysis_item_stats(p_exam);
  v_summary := public.analysis_summary(p_exam);
  insert into item_stat_rounds(item_id, version, grade_id, source_exam_id, n, n_correct, r, option_counts)
  select (s->>'item_id')::uuid, (s->>'version')::int, e.grade_id, p_exam, (s->>'n')::int, (s->>'n_correct')::int,
         (s->>'r')::numeric, s->'option_counts'
  from jsonb_array_elements(v_stats) s where (s->>'n')::int > 0;
  get diagnostics v_rows = row_count;
  update exams set status = p_status, closed_at = now() where id = p_exam;
  delete from responses where exam_id = p_exam;
  get diagnostics v_deleted = row_count;
  v_summary := v_summary || jsonb_build_object('items_recorded', v_rows, 'responses_deleted', v_deleted, 'finalized_as', p_status, 'finalized_at', now());
  update exams set closed_summary = v_summary where id = p_exam;
  return v_summary;
end $$;

-- =====================================================================
-- ฟังก์ชันสำหรับหน้าเว็บ
-- =====================================================================
create or replace function public.gb_require_classroom(p_classroom uuid, p_open boolean default true)
returns public.gb_classrooms language plpgsql stable security definer set search_path = public as $$
declare c gb_classrooms%rowtype;
begin
  if auth.uid() is null or not public.app_owns_classroom(p_classroom) then raise exception 'ไม่พบห้องเรียน'; end if;
  select * into c from gb_classrooms where id = p_classroom;
  if p_open and c.status <> 'open' then raise exception 'ห้องนี้ปิดเทอมแล้ว แก้ไขไม่ได้'; end if;
  return c;
end $$;

-- สร้างห้อง: {name, grade_id, academic_year, term, student_count, subject_id?, settings?, final_max?, indicators?: [{indicator_id, max_score}]}
--   สร้างช่องปลายภาคให้อัตโนมัติ (คะแนนเต็มเริ่มต้น gradebook.default_final)
create or replace function public.gb_classroom_create(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; r jsonb; v_sort int := 0;
begin
  if auth.uid() is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  if exists (select 1 from gb_classrooms where owner_id = auth.uid() and status = 'open'
             and academic_year = (p->>'academic_year')::int and term = (p->>'term')::smallint
             and lower(btrim(name)) = lower(btrim(p->>'name'))) then
    raise exception 'มีห้อง % ภาคเรียนที่ %/% อยู่แล้ว', btrim(p->>'name'), p->>'term', p->>'academic_year';
  end if;
  insert into gb_classrooms(owner_id, subject_id, grade_id, academic_year, term, name, student_count, settings)
  values (auth.uid(), coalesce(p->>'subject_id', 'MATH'), p->>'grade_id', (p->>'academic_year')::int, (p->>'term')::smallint,
          btrim(p->>'name'), (p->>'student_count')::int, coalesce(p->'settings', '{}'::jsonb))
  returning id into v_id;
  insert into gb_columns(classroom_id, kind, max_score, sort)
  values (v_id, 'final', coalesce((p->>'final_max')::numeric, public.app_setting_num('gradebook.default_final', 30)), 0);
  for r in select * from jsonb_array_elements(coalesce(p->'indicators', '[]'::jsonb)) loop
    v_sort := v_sort + 1;
    perform public.gb_column_add_internal(v_id, 'indicator', r->>'indicator_id', null, (r->>'max_score')::numeric, v_sort);
  end loop;
  return v_id;
end $$;

-- แก้ห้อง: {name?, student_count?, settings? (รวมกับของเดิม; ค่า null = กลับไปใช้ค่าเริ่มต้น)}
create or replace function public.gb_classroom_update(p_classroom uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare c gb_classrooms%rowtype; v_settings jsonb;
begin
  c := public.gb_require_classroom(p_classroom);
  v_settings := jsonb_strip_nulls(c.settings || coalesce(p->'settings', '{}'::jsonb));
  if p ? 'name' and exists (select 1 from gb_classrooms where owner_id = c.owner_id and status = 'open' and id <> c.id
             and academic_year = c.academic_year and term = c.term and lower(btrim(name)) = lower(btrim(p->>'name'))) then
    raise exception 'มีห้อง % ภาคเรียนนี้อยู่แล้ว', btrim(p->>'name');
  end if;
  update gb_classrooms set
    name = coalesce(btrim(p->>'name'), name),
    student_count = coalesce((p->>'student_count')::int, student_count),
    settings = v_settings
  where id = p_classroom;
end $$;

create or replace function public.gb_column_add_internal(p_classroom uuid, p_kind text, p_indicator text, p_label text, p_max numeric, p_sort int)
returns bigint language plpgsql security definer set search_path = public as $$
declare c gb_classrooms%rowtype; v_id bigint; v_subject text;
begin
  select * into c from gb_classrooms where id = p_classroom;
  if p_kind not in ('indicator', 'other') then raise exception 'เพิ่มได้เฉพาะช่องตัวชี้วัดหรือช่องอื่น (ช่องปลายภาคมีอยู่แล้ว)'; end if;
  if p_kind = 'indicator' then
    select subject_id into v_subject from indicators where id = p_indicator and active;
    if v_subject is null then raise exception 'ไม่พบตัวชี้วัด %', p_indicator; end if;
    if v_subject <> c.subject_id then raise exception 'ตัวชี้วัด % ไม่ใช่วิชาของห้องนี้', p_indicator; end if;
    if exists (select 1 from gb_columns where classroom_id = p_classroom and kind = 'indicator' and indicator_id = p_indicator) then
      raise exception 'ตัวชี้วัดนี้มีในห้องแล้ว';
    end if;
  end if;
  insert into gb_columns(classroom_id, kind, indicator_id, label, max_score, sort)
  values (p_classroom, p_kind, case when p_kind = 'indicator' then p_indicator end, nullif(btrim(p_label), ''), p_max,
          coalesce(p_sort, (select coalesce(max(sort), 0) + 1 from gb_columns where classroom_id = p_classroom and kind <> 'final')))
  returning id into v_id;
  return v_id;
end $$;

-- เพิ่มช่อง (ต่อท้ายลำดับ) — p_max = null คือยังไม่ตั้งคะแนน
create or replace function public.gb_column_add(p_classroom uuid, p_kind text, p_indicator text default null, p_label text default null, p_max numeric default null)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  perform public.gb_require_classroom(p_classroom);
  return public.gb_column_add_internal(p_classroom, p_kind, p_indicator, p_label, p_max, null);
end $$;

-- แก้คะแนนเต็ม/ชื่อช่อง — p_clear_max = true คือกลับเป็น "ยังไม่ตั้งคะแนน"
create or replace function public.gb_column_update(p_column bigint, p_max numeric default null, p_label text default null, p_clear_max boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare col gb_columns%rowtype;
begin
  select * into col from gb_columns where id = p_column;
  if not found then raise exception 'ไม่พบช่องคะแนน'; end if;
  perform public.gb_require_classroom(col.classroom_id);
  update gb_columns set
    max_score = case when p_clear_max then null else coalesce(p_max, max_score) end,
    label = case when kind = 'other' then coalesce(nullif(btrim(p_label), ''), label) else label end
  where id = p_column;
end $$;

-- เรียงช่องตามแผนการสอน — ต้องส่ง id ของทุกช่องที่ไม่ใช่ปลายภาค ครบทุกช่อง
create or replace function public.gb_column_reorder(p_classroom uuid, p_ids bigint[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.gb_require_classroom(p_classroom);
  if (select array_agg(id order by id) from gb_columns where classroom_id = p_classroom and kind <> 'final')
     is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception 'ลำดับช่องไม่ครบหรือมีช่องที่ไม่ใช่ของห้องนี้';
  end if;
  update gb_columns c set sort = o.ord from unnest(p_ids) with ordinality o(id, ord) where c.id = o.id;
end $$;

-- ลบช่อง (ไม่ใช่ปลายภาค) — คะแนนจริงจากการสอบไม่หาย เพิ่มตัวชี้วัดเดิมกลับมาคะแนนกลับมาด้วย แต่คะแนนที่ปรับของช่องนี้หาย
create or replace function public.gb_column_delete(p_column bigint)
returns void language plpgsql security definer set search_path = public as $$
declare col gb_columns%rowtype;
begin
  select * into col from gb_columns where id = p_column;
  if not found then raise exception 'ไม่พบช่องคะแนน'; end if;
  perform public.gb_require_classroom(col.classroom_id);
  if col.kind = 'final' then raise exception 'ลบช่องปลายภาคไม่ได้ (ตั้งคะแนนเต็มเป็น 0 ได้ถ้าไม่ใช้)'; end if;
  delete from gb_columns where id = p_column;
end $$;

-- ผูกชุดข้อสอบกับห้อง (ทำได้ก่อนมีผลตรวจเท่านั้น)
--   p_purpose: collect | final | practice · p_retake_of: ชุดเดิมที่ชุดนี้เป็นสอบซ่อม/สอบซ้ำ (ต้องอยู่ห้องเดียวกัน ประเภทเดียวกัน)
create or replace function public.gb_exam_link(p_exam uuid, p_classroom uuid, p_purpose text, p_retake_of uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare e exams%rowtype; c gb_classrooms%rowtype; root exams%rowtype;
begin
  if auth.uid() is null or not public.app_owns_exam(p_exam) then raise exception 'ไม่พบชุดข้อสอบ'; end if;
  select * into e from exams where id = p_exam;
  if e.status in ('closed', 'expired') then raise exception 'ชุดข้อสอบนี้ปิดแล้ว'; end if;
  if exists (select 1 from responses where exam_id = p_exam) then
    raise exception 'ชุดข้อสอบนี้มีผลตรวจแล้ว เปลี่ยนห้อง/ประเภทการสอบไม่ได้';
  end if;
  if p_purpose not in ('collect', 'final', 'practice') then raise exception 'ประเภทการสอบไม่ถูกต้อง'; end if;
  if p_classroom is null then
    if p_purpose <> 'practice' then raise exception 'ชุดเก็บคะแนน/ปลายภาคต้องเลือกห้องเรียน'; end if;
    if p_retake_of is not null then raise exception 'สอบซ่อมต้องเลือกห้องเรียน'; end if;
  else
    c := public.gb_require_classroom(p_classroom);
    if c.subject_id <> e.subject_id then raise exception 'วิชาของชุดข้อสอบไม่ตรงกับห้อง'; end if;
  end if;
  if p_retake_of is not null then
    select * into root from exams where id = p_retake_of;
    if not found or not public.app_owns_exam(p_retake_of) then raise exception 'ไม่พบชุดข้อสอบเดิม'; end if;
    if root.id = e.id then raise exception 'ชุดข้อสอบเป็นสอบซ่อมของตัวเองไม่ได้'; end if;
    if root.classroom_id is distinct from p_classroom or root.purpose <> p_purpose then
      raise exception 'สอบซ่อมต้องอยู่ห้องเดียวกันและประเภทการสอบเดียวกับชุดเดิม';
    end if;
    if root.retake_of is not null then p_retake_of := root.retake_of; end if;   -- ชี้ไปชุดแรกของกลุ่มเสมอ
  end if;
  if exists (select 1 from exams where retake_of = p_exam) and p_retake_of is not null then
    raise exception 'ชุดนี้มีสอบซ่อมผูกอยู่แล้ว จึงเป็นสอบซ่อมของชุดอื่นไม่ได้';
  end if;
  update exams set classroom_id = p_classroom, purpose = p_purpose, retake_of = p_retake_of where id = p_exam;
end $$;

-- ปรับคะแนน (ปรับให้ผ่าน / แก้เอง) — คะแนนจริงยังอยู่ · p_score = null คือยกเลิกการปรับ
create or replace function public.gb_override_set(p_column bigint, p_seat int, p_score numeric, p_reason text default 'manual')
returns void language plpgsql security definer set search_path = public as $$
declare col gb_columns%rowtype; c gb_classrooms%rowtype;
begin
  select * into col from gb_columns where id = p_column;
  if not found then raise exception 'ไม่พบช่องคะแนน'; end if;
  c := public.gb_require_classroom(col.classroom_id);
  if p_seat is null or p_seat < 1 or p_seat > greatest(c.student_count, 1) then raise exception 'ไม่มีเลขที่ % ในห้องนี้', p_seat; end if;
  if p_score is null then
    delete from gb_overrides where column_id = p_column and seat_no = p_seat;
    return;
  end if;
  if p_score < 0 or (col.max_score is not null and p_score > col.max_score) then
    raise exception 'คะแนนต้องอยู่ระหว่าง 0 ถึง %', col.max_score;
  end if;
  if p_reason not in ('pass', 'manual') then raise exception 'เหตุผลการปรับไม่ถูกต้อง'; end if;
  insert into gb_overrides(column_id, seat_no, score, reason) values (p_column, p_seat, p_score, p_reason)
  on conflict (column_id, seat_no) do update set score = excluded.score, reason = excluded.reason, updated_at = now();
end $$;

-- ครูเลือกครั้งที่นับ (ใช้เมื่อ retake_policy = manual) · p_chosen = null คือยกเลิก
create or replace function public.gb_retake_choose(p_root uuid, p_seat int, p_chosen uuid)
returns void language plpgsql security definer set search_path = public as $$
declare root exams%rowtype;
begin
  if auth.uid() is null or not public.app_owns_exam(p_root) then raise exception 'ไม่พบชุดข้อสอบ'; end if;
  select * into root from exams where id = p_root;
  if root.retake_of is not null then raise exception 'ต้องระบุชุดแรกของกลุ่มสอบซ่อม'; end if;
  if root.classroom_id is null then raise exception 'ชุดนี้ไม่ได้ผูกห้องเรียน'; end if;
  perform public.gb_require_classroom(root.classroom_id);
  if p_chosen is null then
    delete from gb_retake_choices where root_exam_id = p_root and seat_no = p_seat;
    return;
  end if;
  if p_chosen <> p_root and not exists (select 1 from exams where id = p_chosen and retake_of = p_root) then
    raise exception 'ชุดที่เลือกไม่ใช่สอบซ่อมของชุดนี้';
  end if;
  if not exists (select 1 from gb_attempts where exam_id = p_chosen and seat_no = p_seat) then
    raise exception 'เลขที่ % ไม่มีผลสอบในชุดที่เลือก', p_seat;
  end if;
  insert into gb_retake_choices(root_exam_id, seat_no, chosen_exam_id) values (p_root, p_seat, p_chosen)
  on conflict (root_exam_id, seat_no) do update set chosen_exam_id = excluded.chosen_exam_id, updated_at = now();
end $$;

-- =====================================================================
-- สมุดคะแนนทั้งห้อง
--   กลุ่มการสอบ = ชุดแรก + สอบซ่อมของมัน · เป้าหมาย = ตัวชี้วัด (ชุดเก็บคะแนน) หรือ #FINAL (ชุดปลายภาค)
--   ต่อเลขที่ ต่อกลุ่ม: เลือกสัดส่วนถูกตาม retake_policy · ไม่มีผลสอบในกลุ่ม = ขาดสอบ (absent_policy)
--   ต่อช่อง: sum = Σ(สัดส่วน×จำนวนข้อของกลุ่ม) / Σจำนวนข้อ · mean = เฉลี่ยสัดส่วนของแต่ละกลุ่ม → × คะแนนเต็ม
--   นับเฉพาะกลุ่มที่มีผลสอบแล้วอย่างน้อย 1 คน (ชุดที่ยังไม่สอบไม่ทำให้ทุกคนได้ 0)
--   real = คะแนนจริง · adjusted = คะแนนที่ครูปรับ · value = (ปรับ ถ้ามี ไม่งั้นจริง) ปัดตาม rounding
--   รวม = ผลรวมของ value (ตรงกับสูตร SUM ในชีทส่งออก)
-- =====================================================================
create or replace function public.gb_sheet(p_classroom uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  c gb_classrooms%rowtype; v_round text; v_agg text; v_retake text; v_absent text; v_digits int; v_n int; v jsonb;
begin
  if auth.uid() is not null and not public.app_owns_classroom(p_classroom) then raise exception 'ไม่พบห้องเรียน'; end if;
  select * into c from gb_classrooms where id = p_classroom;
  if not found then raise exception 'ไม่พบห้องเรียน'; end if;
  v_round := public.gb_setting(c.settings, 'rounding') #>> '{}';
  v_agg := public.gb_setting(c.settings, 'aggregation') #>> '{}';
  v_retake := public.gb_setting(c.settings, 'retake_policy') #>> '{}';
  v_absent := public.gb_setting(c.settings, 'absent_policy') #>> '{}';
  v_digits := case when v_round = '1dp' then 1 else 0 end;
  select greatest(c.student_count, coalesce(max(a.seat_no), 0)) into v_n
  from gb_attempts a join exams e on e.id = a.exam_id where e.classroom_id = p_classroom;

  create temp table if not exists _gb_ex (id uuid, root uuid, purpose text, created_at timestamptz, title text) on commit drop;
  create temp table if not exists _gb_un (exam_id uuid, root uuid, created_at timestamptz, seat_no int, target text, c int, t int) on commit drop;
  create temp table if not exists _gb_grp (root uuid, target text, t int, exams jsonb) on commit drop;
  create temp table if not exists _gb_sel (root uuid, target text, t int, seat_no int, ratio numeric, attempts int) on commit drop;
  create temp table if not exists _gb_cell (column_id bigint, seat_no int, raw_correct numeric, raw_total numeric, real numeric,
                                            adjusted numeric, reason text, value numeric, missing jsonb) on commit drop;
  truncate _gb_ex, _gb_un, _gb_grp, _gb_sel, _gb_cell;

  insert into _gb_ex select e.id, coalesce(e.retake_of, e.id), e.purpose, e.created_at, e.title
  from exams e where e.classroom_id = p_classroom and e.purpose in ('collect', 'final');
  insert into _gb_un
  select a.exam_id, ex.root, ex.created_at, a.seat_no, case when ex.purpose = 'final' then '#FINAL' else a.indicator_id end,
         sum(a.correct)::int, sum(a.total)::int
  from gb_attempts a join _gb_ex ex on ex.id = a.exam_id
  group by 1, 2, 3, 4, 5;
  insert into _gb_grp
  select u.root, u.target,
         (select max(xt.t) from (select count(*)::int t from exam_items x join _gb_ex e2 on e2.id = x.exam_id
                                 where e2.root = u.root and (case when e2.purpose = 'final' then '#FINAL' else x.indicator_id end) = u.target
                                 group by x.exam_id) xt),
         (select jsonb_agg(distinct u2.exam_id) from _gb_un u2 where u2.root = u.root and u2.target = u.target)
  from (select distinct root, target from _gb_un) u;
  insert into _gb_sel
  select g.root, g.target, g.t, s.seat_no,
         case when st.n = 0 then null
              when v_retake = 'max' then st.mx
              when v_retake = 'latest' then st.lt
              when v_retake = 'mean' then st.av
              else coalesce(st.ch, st.mx) end,
         st.n
  from _gb_grp g cross join generate_series(1, v_n) s(seat_no)
  cross join lateral (
    select count(*)::int n, max(u.c::numeric / u.t) mx, avg(u.c::numeric / u.t) av,
           (array_agg(u.c::numeric / u.t order by u.created_at desc, u.exam_id desc))[1] lt,
           max(u.c::numeric / u.t) filter (where u.exam_id = (select rc.chosen_exam_id from gb_retake_choices rc
                                                              where rc.root_exam_id = g.root and rc.seat_no = s.seat_no)) ch
    from _gb_un u where u.root = g.root and u.target = g.target and u.seat_no = s.seat_no) st;

  insert into _gb_cell
  select col.id, s.seat_no, k.rc, k.rt,
         case when col.max_score is null or col.kind = 'other' then null
              when v_agg = 'mean' then round(k.mr * col.max_score, 4)
              else round(k.rc / nullif(k.rt, 0) * col.max_score, 4) end,
         o.score, o.reason, null, k.missing
  from gb_columns col
  cross join generate_series(1, v_n) s(seat_no)
  cross join lateral (
    select sum(case when sel.ratio is null and v_absent = 'skip' then null else coalesce(sel.ratio, 0) * sel.t end) rc,
           sum(case when sel.ratio is null and v_absent = 'skip' then null else sel.t end) rt,
           avg(case when sel.ratio is null and v_absent = 'skip' then null else coalesce(sel.ratio, 0) end) mr,
           coalesce(jsonb_agg(sel.root) filter (where sel.ratio is null), '[]'::jsonb) missing
    from _gb_sel sel
    where sel.seat_no = s.seat_no and sel.target = case col.kind when 'final' then '#FINAL' when 'indicator' then col.indicator_id end) k
  left join gb_overrides o on o.column_id = col.id and o.seat_no = s.seat_no
  where col.classroom_id = p_classroom;
  update _gb_cell set value = round(coalesce(adjusted, real), v_digits);

  select jsonb_build_object(
    'classroom', jsonb_build_object('id', c.id, 'name', c.name, 'subject_id', c.subject_id, 'grade_id', c.grade_id,
                   'academic_year', c.academic_year, 'term', c.term, 'student_count', c.student_count, 'status', c.status,
                   'settings', jsonb_build_object('rounding', v_round, 'aggregation', v_agg, 'retake_policy', v_retake,
                                                  'absent_policy', v_absent,
                                                  'show_other_columns', public.gb_setting(c.settings, 'show_other_columns'))),
    'seat_count', v_n,
    'columns', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', col.id, 'kind', col.kind, 'indicator_id', col.indicator_id, 'code', i.code, 'standard_code', i.standard_code,
                   'indicator_code', btrim(substr(i.code, length(i.standard_code) + 1)), 'text', i.text,
                   'label', col.label, 'max_score', col.max_score, 'scale', col.scale, 'sort', col.sort,
                   'collected', exists (select 1 from _gb_grp g where g.target = case col.kind when 'final' then '#FINAL' else col.indicator_id end),
                   'groups', (select coalesce(jsonb_agg(jsonb_build_object('root', g.root, 'item_total', g.t, 'exams', g.exams)), '[]'::jsonb)
                              from _gb_grp g where g.target = case col.kind when 'final' then '#FINAL' else col.indicator_id end))
                 order by (col.kind = 'final'), col.sort, col.id), '[]'::jsonb)
                from gb_columns col left join indicators i on i.id = col.indicator_id where col.classroom_id = p_classroom),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                'seat_no', s.seat_no,
                'cells', (select jsonb_agg(jsonb_build_object('column_id', x.column_id, 'raw_correct', round(x.raw_correct, 2),
                             'raw_total', x.raw_total, 'real', round(x.real, 2), 'adjusted', x.adjusted, 'reason', x.reason,
                             'value', x.value, 'missing', x.missing) order by (col.kind = 'final'), col.sort, col.id)
                          from _gb_cell x join gb_columns col on col.id = x.column_id where x.seat_no = s.seat_no),
                'total_collect', (select sum(x.value) from _gb_cell x join gb_columns col on col.id = x.column_id
                                  where x.seat_no = s.seat_no and col.kind <> 'final'),
                'total_final', (select sum(x.value) from _gb_cell x join gb_columns col on col.id = x.column_id
                                where x.seat_no = s.seat_no and col.kind = 'final'),
                'total', (select sum(x.value) from _gb_cell x where x.seat_no = s.seat_no))
              order by s.seat_no), '[]'::jsonb) from generate_series(1, v_n) s(seat_no)),
    'totals', jsonb_build_object(
                'collect_max', (select sum(max_score) from gb_columns where classroom_id = p_classroom and kind <> 'final'),
                'final_max', (select sum(max_score) from gb_columns where classroom_id = p_classroom and kind = 'final'),
                'max', (select sum(max_score) from gb_columns where classroom_id = p_classroom),
                'unset_columns', (select count(*) from gb_columns where classroom_id = p_classroom and max_score is null)),
    'unplanned_indicators', (select coalesce(jsonb_agg(distinct g.target), '[]'::jsonb) from _gb_grp g
                             where g.target <> '#FINAL' and not exists (select 1 from gb_columns col where col.classroom_id = p_classroom
                                                                         and col.kind = 'indicator' and col.indicator_id = g.target)),
    'exams', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'purpose', e.purpose, 'retake_of', e.retake_of,
                                 'status', e.status, 'created_at', e.created_at) order by e.created_at), '[]'::jsonb)
              from exams e where e.classroom_id = p_classroom))
  into v;
  return v;
end $$;

-- รายการห้องของครู
create or replace function public.gb_classroom_list()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'subject_id', c.subject_id, 'grade_id', c.grade_id, 'academic_year', c.academic_year,
           'term', c.term, 'student_count', c.student_count, 'status', c.status, 'created_at', c.created_at, 'closed_at', c.closed_at,
           'column_count', (select count(*) from gb_columns col where col.classroom_id = c.id and col.kind <> 'final'),
           'exam_count', (select count(*) from exams e where e.classroom_id = c.id))
         order by c.status, c.academic_year desc, c.term desc, c.name), '[]'::jsonb)
  from gb_classrooms c where c.owner_id = auth.uid()
$$;

-- ปิดเทอม: (หน้าเว็บให้ส่งออกชีทฉบับสุดท้ายก่อน)
--   1) ปิดชุดที่ผูกห้องและยังเปิด → สถิติรายข้อเข้าคลัง (ชุดที่ยังไม่เคยสอบ ปล่อยไว้ แต่ยกเลิกผูกห้อง)
--   2) เก็บค่ารวมระดับห้องต่อช่อง (ค่าเฉลี่ย ต่ำสุด สูงสุด) — ไม่มีเลขที่
--   3) ลบข้อมูลรายเลขที่ทั้งหมดของห้อง: คะแนนจริง คะแนนที่ปรับ การเลือกครั้งที่นับ
create or replace function public.gb_classroom_close(p_classroom uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c gb_classrooms%rowtype; v_sheet jsonb; v_summary jsonb; v_id uuid; v_closed int := 0; v_att int; v_ovr int;
begin
  c := public.gb_require_classroom(p_classroom);
  perform 1 from gb_classrooms where id = p_classroom for update;
  for v_id in select id from exams where classroom_id = p_classroom and status in ('draft', 'open')
              and exists (select 1 from responses r where r.exam_id = exams.id) order by created_at loop
    perform public.exam_finalize(v_id, 'closed');
    v_closed := v_closed + 1;
  end loop;
  v_sheet := public.gb_sheet(p_classroom);
  select jsonb_build_object(
    'seat_count', v_sheet->'seat_count',
    'columns', (select coalesce(jsonb_agg(jsonb_build_object(
                  'kind', col->>'kind', 'indicator_id', col->>'indicator_id', 'label', col->>'label', 'max_score', col->'max_score',
                  'collected', col->'collected',
                  'mean', (select round(avg((cell->>'value')::numeric), 2) from jsonb_array_elements(v_sheet->'rows') r,
                            jsonb_array_elements(r->'cells') cell where (cell->>'column_id') = (col->>'id')),
                  'min', (select min((cell->>'value')::numeric) from jsonb_array_elements(v_sheet->'rows') r,
                            jsonb_array_elements(r->'cells') cell where (cell->>'column_id') = (col->>'id')),
                  'max', (select max((cell->>'value')::numeric) from jsonb_array_elements(v_sheet->'rows') r,
                            jsonb_array_elements(r->'cells') cell where (cell->>'column_id') = (col->>'id')))), '[]'::jsonb)
                from jsonb_array_elements(v_sheet->'columns') col),
    'total_mean', (select round(avg((r->>'total')::numeric), 2) from jsonb_array_elements(v_sheet->'rows') r),
    'exams_closed', v_closed)
  into v_summary;
  delete from gb_retake_choices where root_exam_id in (select id from exams where classroom_id = p_classroom);
  delete from gb_overrides where column_id in (select id from gb_columns where classroom_id = p_classroom);
  get diagnostics v_ovr = row_count;
  delete from gb_attempts where exam_id in (select id from exams where classroom_id = p_classroom);
  get diagnostics v_att = row_count;
  -- ชุดที่ยังไม่เคยสอบ: ยกเลิกผูกห้อง (กลับเป็นชุดฝึก ใช้กติกาเดิม)
  update exams set classroom_id = null, purpose = 'practice', retake_of = null
  where classroom_id = p_classroom and status in ('draft', 'open');
  v_summary := v_summary || jsonb_build_object('attempts_deleted', v_att, 'overrides_deleted', v_ovr, 'closed_at', now());
  update gb_classrooms set status = 'closed', closed_at = now(), closed_summary = v_summary where id = p_classroom;
  return v_summary;
end $$;

-- ลบห้อง: ได้เมื่อปิดเทอมแล้ว หรือยังไม่มีคะแนนจากการสอบเลย
create or replace function public.gb_classroom_delete(p_classroom uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c gb_classrooms%rowtype;
begin
  c := public.gb_require_classroom(p_classroom, false);
  if c.status = 'open' and exists (select 1 from gb_attempts a join exams e on e.id = a.exam_id where e.classroom_id = p_classroom) then
    raise exception 'ห้องนี้มีคะแนนจากการสอบแล้ว — ให้ปิดเทอมก่อนจึงลบได้';
  end if;
  update exams set classroom_id = null, purpose = 'practice', retake_of = null where classroom_id = p_classroom;
  delete from gb_classrooms where id = p_classroom;
end $$;

-- ---------- สิทธิ์เรียกฟังก์ชัน ----------
revoke execute on function public.gb_refresh_attempts(uuid, int) from public, anon, authenticated;
revoke execute on function public.gb_column_add_internal(uuid, text, text, text, numeric, int) from public, anon, authenticated;
revoke execute on function public.gb_require_classroom(uuid, boolean) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'gb_classroom_create(jsonb)', 'gb_classroom_update(uuid, jsonb)', 'gb_column_add(uuid, text, text, text, numeric)',
    'gb_column_update(bigint, numeric, text, boolean)', 'gb_column_reorder(uuid, bigint[])', 'gb_column_delete(bigint)',
    'gb_exam_link(uuid, uuid, text, uuid)', 'gb_override_set(bigint, int, numeric, text)', 'gb_retake_choose(uuid, int, uuid)',
    'gb_sheet(uuid)', 'gb_classroom_list()', 'gb_classroom_close(uuid)', 'gb_classroom_delete(uuid)']
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
