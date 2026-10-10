-- =====================================================================
-- 0010_calibration.sql — เฟส 7 วงจรปรับความยาก (SPEC §11) + หน้าสรุปสุขภาพคลัง
--   * สถิติที่ใช้ตัดสิน   : เวอร์ชันปัจจุบันของข้อ เฉพาะรอบสอบของชั้นเดียวกับตัวชี้วัด (calibration.same_grade_only)
--                          p = ตอบถูก/n · r = เฉลี่ยถ่วงด้วย n ของรอบที่มีค่า r
--   * ย้ายระดับ           : เมื่อ n ≥ calibration.min_n_to_move และ p ออกนอกช่วงของระดับปัจจุบันเกินช่วงกันชน
--                          (ลงเมื่อ p < เส้นล่าง − กันชน · ขึ้นเมื่อ p > เส้นบน + กันชน) → ย้ายไประดับที่ p ตกอยู่
--                          ระดับที่ p ตกอยู่ = ระดับแรก (เรียงเส้นล่างมาก→น้อย) ที่ p > เส้นล่าง (ง่าย > 0.80 · ปานกลาง 0.50–0.80 ฯลฯ)
--   * ค่า r (เมื่อ n ที่มี r ≥ calibration.r_min_n) : r < 0 → ป้าย "ต้องแก้ด่วน" + สถานะ "ต้องแก้" (หยุดสุ่มเข้าชุด)
--                          0 ≤ r < calibration.r_flag_below → ป้าย "ต้องแก้" แต่ยังสุ่มเข้าชุดได้ (ครูเลือก 10 ต.ค. 2569)
--                          r ดีขึ้น → ป้ายหายเอง (สถานะที่ครูตั้งไม่ถูกเปลี่ยนกลับอัตโนมัติ)
--   * การเปรียบเทียบทั้งหมดทำด้วยจำนวนเต็ม (สเกล 1e6) เพื่อให้ผลตรงกับหน้าเว็บ (web/src/modules/calibration/calibrate.ts) ทุกกรณีขอบ
--   * ทำงานอัตโนมัติทุกครั้งที่ปิดชุด/หมดอายุ (สถิติรอบใหม่เข้าคลัง) + ผู้ดูแลสั่ง "ปรับทั้งคลัง" ได้
--   * ประวัติการย้าย (item_level_moves) · บันทึกการปรับแต่ละครั้ง (calibration_runs) พร้อมช่องที่ขาดเพราะข้อย้ายออก
--   * bank_health : หน้าสรุปสุขภาพคลัง
-- =====================================================================
begin;
select public.app_begin_migration('0010', 'calibration: level moves with buffer, r flags, move history, shortfall alerts, bank health');

insert into public.app_settings(key, value, description_th) values
  ('calibration.r_min_n', '50'::jsonb, 'n ขั้นต่ำ (ของรอบที่มีค่า r) ก่อนตัดสินค่า r ว่าต้องแก้'),
  ('calibration.same_grade_only', 'true'::jsonb, 'ใช้เฉพาะสถิติจากนักเรียนชั้นเดียวกับตัวชี้วัดในการปรับความยาก (true/false)'),
  ('calibration.recent_days', '30'::jsonb, 'หน้าสุขภาพคลัง: แสดงการย้ายระดับย้อนหลังกี่วัน')
on conflict (key) do nothing;

create or replace function public.app_setting_bool(p_key text, p_default boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::boolean from public.app_settings
                   where key = p_key and jsonb_typeof(value) = 'boolean'), p_default)
$$;

-- ---------- ป้ายคุณภาพของข้อ ----------
alter table public.items add column quality_flag text check (quality_flag in ('low_r', 'negative_r'));
alter table public.items add column quality_flag_at timestamptz;
alter table public.items add column quality_detail jsonb;   -- {version, n_r, r} ตอนตั้งป้าย

-- ---------- บันทึกการปรับแต่ละครั้ง ----------
create table public.calibration_runs (
  id             bigserial primary key,
  source         text not null check (source in ('exam', 'manual')),
  source_exam_id uuid,                 -- ไม่ผูก FK: ชุดอาจถูกลบภายหลัง
  ran_at         timestamptz not null default now(),
  actor          uuid default auth.uid(),
  items_checked  int not null default 0,
  summary        jsonb not null default '{}'::jsonb
);
create index calibration_runs_exam_idx on public.calibration_runs(source_exam_id);

-- ---------- ประวัติการย้ายระดับ (จาก→ไป วันที่ p n) ----------
create table public.item_level_moves (
  id              bigserial primary key,
  item_id         uuid not null references public.items(id) on delete cascade,
  version         int not null,
  from_difficulty smallint not null references public.difficulty_levels(id),
  to_difficulty   smallint not null references public.difficulty_levels(id),
  direction       text not null check (direction in ('easier', 'harder')),
  p               numeric(6,4) not null,
  n               int not null,
  r               numeric(6,4),
  run_id          bigint references public.calibration_runs(id) on delete set null,
  moved_at        timestamptz not null default now()
);
create index item_level_moves_item_idx on public.item_level_moves(item_id, moved_at);
create index item_level_moves_at_idx on public.item_level_moves(moved_at);

alter table public.calibration_runs enable row level security;
alter table public.item_level_moves enable row level security;
create policy calibration_runs_bank_admin on public.calibration_runs for select to authenticated using (public.app_is_bank_admin());
create policy item_level_moves_bank_admin on public.item_level_moves for select to authenticated using (public.app_is_bank_admin());

-- ---------- สถิติที่ใช้ปรับความยาก (เวอร์ชันปัจจุบัน ชั้นเดียวกับตัวชี้วัด) ----------
--   r_sum_milli = Σ (r × 1000) × n ของรอบที่มี r  → r เฉลี่ย = r_sum_milli / 1000 / n_r
create view public.item_calib_stats with (security_invoker = true) as
select i.id as item_id, i.current_version as version, ind.grade_id,
       coalesce(sum(s.n), 0)::int as n,
       coalesce(sum(s.n_correct), 0)::int as n_correct,
       coalesce(sum(s.n) filter (where s.r is not null), 0)::int as n_r,
       coalesce(sum(round(s.r * 1000) * s.n) filter (where s.r is not null), 0)::bigint as r_sum_milli,
       case when sum(s.n) > 0 then round(sum(s.n_correct)::numeric / sum(s.n), 4) end as p,
       case when sum(s.n) filter (where s.r is not null) > 0
            then round(sum(round(s.r * 1000) * s.n) filter (where s.r is not null)::numeric / 1000
                       / sum(s.n) filter (where s.r is not null), 4) end as r,
       count(s.id)::int as rounds
from public.items i
join public.indicators ind on ind.id = i.indicator_id
left join public.item_stat_rounds s
       on s.item_id = i.id and s.version = i.current_version
      and (not public.app_setting_bool('calibration.same_grade_only', true) or s.grade_id = ind.grade_id)
group by i.id, i.current_version, ind.grade_id;

-- ---------- ตัวตัดสิน (ฟังก์ชันล้วน ไม่แก้ข้อมูล) ----------
--   คืน {target: id ระดับใหม่|null, direction, flag: null|'low_r'|'negative_r'}
create or replace function public.calib_decide(p_cur smallint, p_n int, p_nc int, p_nr int, p_r_sum_milli bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_min_n int := public.app_setting_num('calibration.min_n_to_move', 50)::int;
  v_buf numeric := public.app_setting_num('calibration.buffer', 0.05);
  v_r_min_n int := public.app_setting_num('calibration.r_min_n', 50)::int;
  v_r_flag numeric := public.app_setting_num('calibration.r_flag_below', 0.2);
  c difficulty_levels%rowtype;
  v_bottom numeric; v_top numeric;
  v_target smallint; v_dir text; v_flag text;
begin
  select * into c from difficulty_levels where id = p_cur;
  select min(p_lower), max(p_upper) into v_bottom, v_top from difficulty_levels;
  if c.id is not null and p_n >= greatest(v_min_n, 1) then
    if c.p_lower > v_bottom and p_nc::numeric * 1000000 < round((c.p_lower - v_buf) * 1000000) * p_n then
      v_dir := 'harder';
    elsif c.p_upper < v_top and p_nc::numeric * 1000000 > round((c.p_upper + v_buf) * 1000000) * p_n then
      v_dir := 'easier';
    end if;
    if v_dir is not null then
      select d.id into v_target from difficulty_levels d
       where p_nc::numeric * 1000000 > round(d.p_lower * 1000000) * p_n
       order by d.p_lower desc, d.id limit 1;
      if v_target is null then
        select d.id into v_target from difficulty_levels d order by d.p_lower asc, d.id limit 1;
      end if;
      if v_target = p_cur then v_target := null; v_dir := null; end if;
    end if;
  end if;
  if p_nr >= greatest(v_r_min_n, 1) then
    -- r = r_sum_milli / 1000 / n_r → เทียบ r_sum_milli × 1000 กับ เกณฑ์ × 1e6 × n_r
    if p_r_sum_milli < 0 then
      v_flag := 'negative_r';
    elsif p_r_sum_milli::numeric * 1000 < round(v_r_flag * 1000000) * p_nr then
      v_flag := 'low_r';
    end if;
  end if;
  return jsonb_build_object('target', v_target, 'direction', v_dir, 'flag', v_flag);
end $$;

-- ---------- ปรับ 1 ข้อ (ใช้ภายใน) ----------
create or replace function public.calib_apply_item(p_item uuid, p_run bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  it items%rowtype; st item_calib_stats%rowtype; d jsonb;
  v_target smallint; v_flag text; v_out jsonb := '{}'::jsonb;
begin
  select * into it from items where id = p_item for update;
  if not found or it.status not in ('reviewed', 'active', 'needs_fix') then return null; end if;
  select * into st from item_calib_stats where item_id = p_item;
  d := public.calib_decide(it.current_difficulty, st.n, st.n_correct, st.n_r, st.r_sum_milli);
  v_target := (d->>'target')::smallint;
  v_flag := d->>'flag';

  if v_target is not null then
    insert into item_level_moves(item_id, version, from_difficulty, to_difficulty, direction, p, n, r, run_id)
    values (p_item, it.current_version, it.current_difficulty, v_target, d->>'direction', st.p, st.n, st.r, p_run);
    update items set current_difficulty = v_target where id = p_item;
    v_out := v_out || jsonb_build_object('moved', jsonb_build_object('item_id', p_item, 'item_code', it.item_code,
               'indicator_id', it.indicator_id, 'from', it.current_difficulty, 'to', v_target, 'direction', d->>'direction',
               'p', st.p, 'n', st.n));
  end if;

  if v_flag is distinct from it.quality_flag then
    update items set quality_flag = v_flag,
                     quality_flag_at = case when v_flag is null then null else now() end,
                     quality_detail = case when v_flag is null then null
                                           else jsonb_build_object('version', it.current_version, 'n_r', st.n_r, 'r', st.r) end
     where id = p_item;
    insert into item_events(item_id, event_type, payload)
    values (p_item, 'quality_flag_changed', jsonb_build_object('from', it.quality_flag, 'to', v_flag, 'r', st.r, 'n_r', st.n_r, 'run_id', p_run));
    if v_flag is null then
      v_out := v_out || jsonb_build_object('unflagged', jsonb_build_object('item_id', p_item, 'item_code', it.item_code, 'from', it.quality_flag, 'r', st.r));
    else
      v_out := v_out || jsonb_build_object('flagged', jsonb_build_object('item_id', p_item, 'item_code', it.item_code,
                 'indicator_id', it.indicator_id, 'flag', v_flag, 'r', st.r, 'n_r', st.n_r));
    end if;
    -- r ติดลบ: หยุดสุ่มเข้าชุด (เปลี่ยนสถานะเฉพาะตอนเพิ่งได้ป้ายนี้ — ครูตั้งสถานะกลับเองได้)
    if v_flag = 'negative_r' and it.status in ('reviewed', 'active') then
      update items set status = 'needs_fix' where id = p_item;
      insert into item_events(item_id, event_type, payload)
      values (p_item, 'note', jsonb_build_object('text', 'ค่า r ติดลบ — หยุดสุ่มเข้าชุดจนกว่าจะแก้', 'status', 'needs_fix'));
      v_out := v_out || jsonb_build_object('stopped', true);
    end if;
  end if;
  return v_out;
end $$;

-- ---------- ปรับหลายข้อ (ใช้ภายใน) ----------
--   p_items = null → ทั้งคลัง · คืนผลสรุป + ช่อง (ตัวชี้วัด × ระดับ) ที่ต่ำกว่าเป้าเพราะมีข้อย้ายออกในรอบนี้
create or replace function public.calib_run_internal(p_items uuid[], p_source text, p_exam uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_run bigint; v_id uuid; r jsonb;
  v_checked int := 0; v_moved jsonb := '[]'::jsonb; v_flagged jsonb := '[]'::jsonb; v_unflagged jsonb := '[]'::jsonb;
  v_stopped int := 0; v_target int := public.app_setting_num('bank.items_per_level_target', 20)::int;
  v_short jsonb; v_summary jsonb;
begin
  insert into calibration_runs(source, source_exam_id) values (p_source, p_exam) returning id into v_run;
  for v_id in
    select i.id from items i
    where i.status in ('reviewed', 'active', 'needs_fix') and (p_items is null or i.id = any(p_items))
    order by i.item_code
  loop
    r := public.calib_apply_item(v_id, v_run);
    if r is null then continue; end if;
    v_checked := v_checked + 1;
    if r ? 'moved' then v_moved := v_moved || jsonb_build_array(r->'moved'); end if;
    if r ? 'flagged' then v_flagged := v_flagged || jsonb_build_array(r->'flagged'); end if;
    if r ? 'unflagged' then v_unflagged := v_unflagged || jsonb_build_array(r->'unflagged'); end if;
    if r ? 'stopped' then v_stopped := v_stopped + 1; end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('indicator_id', c.indicator_id, 'indicator_code', c.indicator_code, 'grade_id', c.grade_id,
           'difficulty_id', c.difficulty_id, 'ready', c.ready_count, 'target', v_target) order by c.grade_id, c.indicator_sort, c.difficulty_id), '[]'::jsonb)
    into v_short
  from bank_coverage c
  where c.ready_count < v_target
    and exists (select 1 from jsonb_array_elements(v_moved) m
                where m->>'indicator_id' = c.indicator_id and (m->>'from')::int = c.difficulty_id);

  v_summary := jsonb_build_object('run_id', v_run, 'source', p_source, 'exam_id', p_exam, 'items_checked', v_checked,
    'moved', v_moved, 'flagged', v_flagged, 'unflagged', v_unflagged, 'stopped', v_stopped, 'shortfalls', v_short);
  update calibration_runs set items_checked = v_checked, summary = v_summary where id = v_run;
  return v_summary;
end $$;

-- ผู้ดูแลสั่งปรับทั้งคลัง (เช่น หลังเปลี่ยนเกณฑ์ในตั้งค่า)
create or replace function public.calib_run(p_item_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.bank_require_admin();
  return public.calib_run_internal(p_item_ids, 'manual', null);
end $$;

-- สถิติรอบใหม่จากการปิดชุด/หมดอายุ → ปรับข้อเหล่านั้นทันที
--   (เฉพาะแถวที่มาจากชุดข้อสอบ — การนำเข้าไฟล์สำรองไม่ย้ายระดับ)
create or replace function public.tg_item_stat_rounds_calibrate()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_exam uuid; v_items uuid[];
begin
  for v_exam in select distinct source_exam_id from new_rows where source_exam_id is not null loop
    select array_agg(distinct item_id) into v_items from new_rows where source_exam_id = v_exam;
    perform public.calib_run_internal(v_items, 'exam', v_exam);
  end loop;
  return null;
end $$;
create trigger item_stat_rounds_calibrate after insert on public.item_stat_rounds
  referencing new table as new_rows for each statement execute function public.tg_item_stat_rounds_calibrate();

-- ---------- รายการข้อ: เพิ่มป้ายคุณภาพ + สถิติที่ใช้ปรับความยาก ----------
create or replace view public.bank_item_list with (security_invoker = true) as
select i.id, i.item_code, i.subject_id, i.indicator_id, ind.grade_id, ind.sort as indicator_sort, ind.code as indicator_code,
       i.item_type, i.cognitive_level, i.est_difficulty, i.current_difficulty, i.status, i.current_version,
       i.no_shuffle, i.is_sample, i.tags, i.subtopic,
       v.content->>'stem' as stem,
       coalesce(jsonb_typeof(v.content->'figure') = 'object', false) as has_figure,
       (v.qa->>'passed')::boolean as qa_passed,
       coalesce(st.n, 0) as n, st.p, st.r,
       i.created_at, i.updated_at,
       i.quality_flag, i.quality_flag_at,
       cs.n as calib_n, cs.p as calib_p, cs.n_r as calib_n_r, cs.r as calib_r
from public.items i
join public.indicators ind on ind.id = i.indicator_id
join public.item_versions v on v.item_id = i.id and v.version = i.current_version
left join public.item_stats st on st.item_id = i.id
left join public.item_calib_stats cs on cs.item_id = i.id;

-- ---------- ข้อมูลปรับความยากของ 1 ข้อ (หน้าแก้ไขข้อ) ----------
create or replace function public.calib_item_info(p_item uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.bank_require_admin();
  select jsonb_build_object(
    'stats', (select to_jsonb(s) from item_calib_stats s where s.item_id = p_item),
    'decision', (select public.calib_decide(i.current_difficulty, s.n, s.n_correct, s.n_r, s.r_sum_milli)
                 from items i join item_calib_stats s on s.item_id = i.id where i.id = p_item),
    'rounds', (select coalesce(jsonb_agg(jsonb_build_object('version', r.version, 'grade_id', r.grade_id, 'n', r.n, 'n_correct', r.n_correct,
                   'r', r.r, 'option_counts', r.option_counts, 'recorded_at', r.recorded_at) order by r.recorded_at, r.id), '[]'::jsonb)
               from item_stat_rounds r where r.item_id = p_item),
    'moves', (select coalesce(jsonb_agg(jsonb_build_object('version', m.version, 'from', m.from_difficulty, 'to', m.to_difficulty,
                   'direction', m.direction, 'p', m.p, 'n', m.n, 'r', m.r, 'moved_at', m.moved_at) order by m.moved_at, m.id), '[]'::jsonb)
              from item_level_moves m where m.item_id = p_item))
  into v;
  return v;
end $$;

-- ---------- หน้าสรุปสุขภาพคลัง ----------
create or replace function public.bank_health(p_subject_id text default 'MATH')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_target int := public.app_setting_num('bank.items_per_level_target', 20)::int;
  v_min_n int := public.app_setting_num('calibration.min_n_to_move', 50)::int;
  v_days int := public.app_setting_num('calibration.recent_days', 30)::int;
  v jsonb;
begin
  perform public.bank_require_admin();
  with it as (
    select i.*, ind.grade_id, ind.code as indicator_code, ind.sort as indicator_sort, cs.n as cn, cs.p as cp, cs.n_r as cnr, cs.r as cr
    from items i join indicators ind on ind.id = i.indicator_id
    left join item_calib_stats cs on cs.item_id = i.id
    where i.subject_id = p_subject_id),
  cov as (select * from bank_coverage where subject_id = p_subject_id)
  select jsonb_build_object(
    'generated_at', now(),
    'settings', jsonb_build_object('target', v_target, 'min_n_to_move', v_min_n, 'buffer', public.app_setting_num('calibration.buffer', 0.05),
                  'r_flag_below', public.app_setting_num('calibration.r_flag_below', 0.2), 'r_min_n', public.app_setting_num('calibration.r_min_n', 50),
                  'same_grade_only', public.app_setting_bool('calibration.same_grade_only', true), 'recent_days', v_days),
    'status_counts', (select coalesce(jsonb_object_agg(s, c), '{}'::jsonb) from (select status as s, count(*) as c from it group by status) x),
    'sample_count', (select count(*) from it where is_sample),
    'n_buckets', (select jsonb_build_object(
                    'none', count(*) filter (where coalesce(cn, 0) = 0),
                    'collecting', count(*) filter (where cn > 0 and cn < v_min_n),
                    'calibrated', count(*) filter (where cn >= v_min_n))
                  from it where status in ('reviewed', 'active', 'needs_fix')),
    'coverage', (select jsonb_build_object('cells', count(*), 'full', count(*) filter (where ready_count >= v_target),
                    'empty', count(*) filter (where ready_count = 0), 'ready_total', coalesce(sum(ready_count), 0),
                    'target_total', count(*) * v_target) from cov),
    'shortfalls', (select coalesce(jsonb_agg(jsonb_build_object('indicator_id', c.indicator_id, 'indicator_code', c.indicator_code,
                      'grade_id', c.grade_id, 'difficulty_id', c.difficulty_id, 'ready', c.ready_count, 'draft', c.draft_count,
                      'needs_fix', c.needs_fix_count, 'need', v_target - c.ready_count,
                      'moved_out', (select count(*) from item_level_moves m join items i2 on i2.id = m.item_id
                                    where i2.indicator_id = c.indicator_id and m.from_difficulty = c.difficulty_id
                                      and m.moved_at > now() - make_interval(days => v_days)))
                    order by c.grade_id, c.indicator_sort, c.difficulty_id), '[]'::jsonb)
                   from cov c where c.ready_count < v_target),
    'flagged', (select coalesce(jsonb_agg(jsonb_build_object('item_id', id, 'item_code', item_code, 'indicator_id', indicator_id,
                   'indicator_code', indicator_code, 'grade_id', grade_id, 'difficulty', current_difficulty, 'status', status,
                   'flag', quality_flag, 'flag_at', quality_flag_at, 'r', cr, 'n_r', cnr, 'p', cp, 'n', cn)
                   order by case quality_flag when 'negative_r' then 0 else 1 end, cr nulls last, item_code), '[]'::jsonb)
                from it where quality_flag is not null and status <> 'retired'),
    'needs_fix_count', (select count(*) from it where status = 'needs_fix'),
    'recent_moves', (select coalesce(jsonb_agg(x order by x->>'moved_at' desc), '[]'::jsonb) from (
                       select jsonb_build_object('item_id', m.item_id, 'item_code', i.item_code, 'indicator_id', i.indicator_id,
                         'indicator_code', i.indicator_code, 'grade_id', i.grade_id, 'from', m.from_difficulty, 'to', m.to_difficulty,
                         'direction', m.direction, 'p', m.p, 'n', m.n, 'moved_at', m.moved_at) as x
                       from item_level_moves m join it i on i.id = m.item_id
                       where m.moved_at > now() - make_interval(days => v_days)
                       order by m.moved_at desc, m.id desc limit 200) y),
    'move_totals', (select jsonb_build_object('easier', count(*) filter (where m.direction = 'easier'),
                       'harder', count(*) filter (where m.direction = 'harder'), 'all_time', count(*))
                    from item_level_moves m join it i on i.id = m.item_id),
    'level_mix', (select coalesce(jsonb_agg(jsonb_build_object('difficulty', d.id, 'est', (select count(*) from it where est_difficulty = d.id and status in ('reviewed','active','needs_fix')),
                     'current', (select count(*) from it where current_difficulty = d.id and status in ('reviewed','active','needs_fix'))) order by d.id), '[]'::jsonb)
                  from difficulty_levels d),
    'runs', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'source', r.source, 'exam_id', r.source_exam_id, 'ran_at', r.ran_at,
                'items_checked', r.items_checked, 'moved', jsonb_array_length(coalesce(r.summary->'moved', '[]')),
                'flagged', jsonb_array_length(coalesce(r.summary->'flagged', '[]')),
                'unflagged', jsonb_array_length(coalesce(r.summary->'unflagged', '[]')),
                'shortfalls', jsonb_array_length(coalesce(r.summary->'shortfalls', '[]'))) order by r.id desc), '[]'::jsonb)
             from (select * from calibration_runs order by id desc limit 10) r))
  into v;
  return v;
end $$;

-- ผลการปรับความยากจากการปิดชุด (หน้าปิดชุด/รายงาน) — ค่ารวมระดับข้อ ไม่มีข้อมูลนักเรียน
create or replace function public.calib_exam_result(p_exam uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.app_owns_exam(p_exam) then raise exception 'ไม่พบชุดข้อสอบ'; end if;
  return (select summary from calibration_runs where source = 'exam' and source_exam_id = p_exam order by id desc limit 1);
end $$;

-- ---------- สิทธิ์ ----------
revoke execute on function public.calib_apply_item(uuid, bigint) from public, anon, authenticated;
revoke execute on function public.calib_run_internal(uuid[], text, uuid) from public, anon, authenticated;
revoke execute on function public.calib_decide(smallint, int, int, int, bigint) from public, anon;
revoke execute on function public.calib_run(uuid[]) from public, anon;
revoke execute on function public.calib_item_info(uuid) from public, anon;
revoke execute on function public.bank_health(text) from public, anon;
revoke execute on function public.calib_exam_result(uuid) from public, anon;
grant execute on function public.calib_decide(smallint, int, int, int, bigint) to authenticated;
grant execute on function public.calib_run(uuid[]) to authenticated;
grant execute on function public.calib_item_info(uuid) to authenticated;
grant execute on function public.bank_health(text) to authenticated;
grant execute on function public.calib_exam_result(uuid) to authenticated;

-- ขึ้นเวอร์ชันใหม่ = สถิติเริ่มนับใหม่ → ป้ายคุณภาพของเวอร์ชันเก่าหมดความหมาย
create or replace function public.tg_items_clear_quality_flag()
returns trigger language plpgsql as $$
begin
  if new.current_version <> old.current_version and old.quality_flag is not null then
    new.quality_flag := null; new.quality_flag_at := null; new.quality_detail := null;
    insert into public.item_events(item_id, event_type, payload)
    values (new.id, 'quality_flag_changed', jsonb_build_object('from', old.quality_flag, 'to', null, 'reason', 'new_version'));
  end if;
  return new;
end $$;
create trigger items_clear_quality_flag before update of current_version on public.items
  for each row execute function public.tg_items_clear_quality_flag();

-- ---------- ปรับข้อที่มีสถิติอยู่แล้วครั้งแรก ----------
do $$ begin perform public.calib_run_internal(null, 'manual', null); end $$;

commit;
