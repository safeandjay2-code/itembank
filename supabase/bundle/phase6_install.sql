-- ติดตั้งเฟส 6 บน Supabase (SQL Editor) — เนื้อหาเดียวกับ supabase/migrations/0009_analysis_close.sql
-- =====================================================================
-- 0009_analysis_close.sql — เฟส 6 วิเคราะห์และปิดชุด (SPEC §9, §10)
--   * analysis_item_stats  : สถิติรายข้อจากผลตรวจ (n, ตอบถูก, r เทคนิค 27%, จำนวนผู้เลือกแต่ละตัวเลือกต้นฉบับ)
--                            กฎเดียวกับ web/src/modules/analysis/analyze.ts (ทดสอบเทียบกันด้วย fixtures/phase6_analysis.json)
--   * analysis_summary     : ภาพรวมห้อง (ค่าเฉลี่ย S.D. มัธยฐาน ผ่านรายตัวชี้วัด) — ค่ารวมระดับห้อง ไม่มีเลขที่
--   * exam_close           : ปิดชุด → รวมสถิติรายข้อเข้า item_stat_rounds → ลบข้อมูลรายเลขที่ (responses) ทั้งหมด
--   * หมดอายุอัตโนมัติ      : ชุดที่เริ่มตรวจแล้วมีวันหมดอายุ (privacy.exam_expiry_days หลังเริ่มตรวจ) — ครบกำหนดแล้ว
--                            ทำเหมือนปิดชุด (รวมสถิติแล้วลบข้อมูลรายเลขที่) สถานะ "หมดอายุ"
--                            ทำงานทุกวันด้วย pg_cron (ถ้ามี) และทุกครั้งที่ผู้ใช้เปิดรายการชุดข้อสอบ (exam_expire_due)
--   * exam_get คืนวันเริ่มตรวจ/ปิด/หมดอายุ + ผลสรุปที่เก็บไว้หลังปิดชุด · ลบชุดที่ปิด/หมดอายุแล้วได้
-- ข้อมูลที่เหลือหลังปิดชุด: ค่ารวมรายข้อ (item_stat_rounds) และค่ารวมระดับห้อง (exams.closed_summary) — ไม่มีคำตอบ/คะแนนรายเลขที่
-- =====================================================================
begin;
select public.app_begin_migration('0009', 'analysis & close: item stats (27%), class summary, close exam, auto-expiry');

insert into public.app_settings(key, value, description_th) values
  ('analysis.group_ratio', '0.27'::jsonb, 'สัดส่วนกลุ่มสูง/กลุ่มต่ำ สำหรับคำนวณค่าอำนาจจำแนก r (เทคนิค 27%)'),
  ('analysis.r_min_n', '6'::jsonb, 'จำนวนนักเรียนขั้นต่ำที่จะคำนวณค่า r ของชุดข้อสอบ (น้อยกว่านี้ไม่คำนวณ)'),
  ('report.strong_distractor_ratio', '0.25'::jsonb, 'ตัวลวงที่มีผู้เลือกตั้งแต่สัดส่วนนี้ (หรือมากกว่าคำตอบถูก) = ตัวลวงที่เด็กหลงมาก'),
  ('report.dead_distractor_ratio', '0.05'::jsonb, 'ตัวลวงที่มีผู้เลือกน้อยกว่าสัดส่วนนี้ = แทบไม่มีใครเลือก (ควรปรับตัวลวง)'),
  ('privacy.expiry_warn_days', '7'::jsonb, 'แจ้งเตือนล่วงหน้ากี่วันก่อนชุดข้อสอบหมดอายุและข้อมูลรายเลขที่ถูกลบ')
on conflict (key) do nothing;

alter table public.exams add column if not exists closed_summary jsonb;

-- ---------- วันหมดอายุ: นับจากวันที่เริ่มตรวจ ----------
create or replace function public.tg_exams_expiry()
returns trigger language plpgsql as $$
begin
  if new.status = 'open' and new.expires_at is null then
    new.expires_at := coalesce(new.opened_at, now()) + make_interval(days => public.app_setting_num('privacy.exam_expiry_days', 60)::int);
  end if;
  return new;
end $$;
create trigger exams_expiry before insert or update of status on public.exams
  for each row execute function public.tg_exams_expiry();

update public.exams set expires_at = coalesce(opened_at, now()) + make_interval(days => public.app_setting_num('privacy.exam_expiry_days', 60)::int)
where status = 'open' and expires_at is null;

-- ---------- คำตอบรายเลขที่ในรูปตัวเลือกต้นฉบับ (ใช้ภายใน) ----------
--   rk = อันดับสำหรับแบ่งกลุ่ม: คะแนนมาก→น้อย, คะแนนเท่ากันเลขที่น้อยก่อน
create or replace function public.analysis_answers(p_exam uuid)
returns table(seat_no int, score int, rk bigint, item_id uuid, indicator_id text, base_position int, item_version int, orig text, correct boolean)
language sql stable security definer set search_path = public as $$
  with ranked as (
    select r.seat_no, r.set_no, r.answers, r.score, row_number() over (order by r.score desc, r.seat_no asc) as rk
    from responses r where r.exam_id = p_exam)
  select k.seat_no, k.score, k.rk, s.item_id, x.indicator_id, x.base_position, x.item_version, a.orig, a.orig = (v.answer->>'choice')
  from ranked k
  join exam_set_items s on s.exam_id = p_exam and s.set_no = k.set_no
  join exam_items x on x.exam_id = p_exam and x.item_id = s.item_id
  join item_versions v on v.item_id = s.item_id and v.version = x.item_version
  cross join lateral (select k.answers -> (s.position - 1) as v) j
  cross join lateral (select case when jsonb_typeof(j.v) = 'number' then s.option_order[(j.v)::int]::text
                                  when j.v = '"multi"'::jsonb then 'multi' else 'blank' end as orig) a
$$;

-- ---------- สถิติรายข้อ ----------
create or replace function public.analysis_item_stats(p_exam uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_n int; v_g int; v_with_r boolean;
begin
  select count(*) into v_n from responses where exam_id = p_exam;
  v_with_r := v_n >= greatest(public.app_setting_num('analysis.r_min_n', 6), 2);
  v_g := case when v_with_r then greatest(1, round(v_n * public.app_setting_num('analysis.group_ratio', 0.27)))::int else 0 end;
  return (
    with st as (
      select a.item_id, count(*)::int as n, count(*) filter (where a.correct)::int as nc,
             count(*) filter (where a.correct and a.rk <= v_g)::int as up,
             count(*) filter (where a.correct and a.rk > v_n - v_g)::int as lo,
             jsonb_build_object('1', count(*) filter (where a.orig = '1'), '2', count(*) filter (where a.orig = '2'),
                                '3', count(*) filter (where a.orig = '3'), '4', count(*) filter (where a.orig = '4'),
                                'blank', count(*) filter (where a.orig = 'blank'), 'multi', count(*) filter (where a.orig = 'multi')) as oc
      from public.analysis_answers(p_exam) a group by a.item_id)
    select coalesce(jsonb_agg(jsonb_build_object(
             'item_id', x.item_id, 'version', x.item_version, 'base_position', x.base_position, 'indicator_id', x.indicator_id,
             'n', coalesce(st.n, 0), 'n_correct', coalesce(st.nc, 0),
             'p', case when coalesce(st.n, 0) > 0 then round(st.nc::numeric / st.n, 3) end,
             'r', case when v_with_r then round((st.up - st.lo)::numeric / v_g, 3) end,
             'group_size', v_g, 'upper_correct', case when v_with_r then st.up else 0 end, 'lower_correct', case when v_with_r then st.lo else 0 end,
             'option_counts', coalesce(st.oc, '{"1":0,"2":0,"3":0,"4":0,"blank":0,"multi":0}'::jsonb))
           order by x.base_position), '[]'::jsonb)
    from exam_items x left join st on st.item_id = x.item_id
    where x.exam_id = p_exam);
end $$;

-- ---------- ภาพรวมห้อง (ค่ารวม ไม่มีเลขที่) ----------
create or replace function public.analysis_summary(p_exam uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  e exams%rowtype; v_pass numeric := public.app_setting_num('report.indicator_pass_ratio', 0.5); v jsonb;
begin
  select * into e from exams where id = p_exam;
  with sc as (select score from responses where exam_id = p_exam),
       per as (select a.seat_no, a.indicator_id, count(*) filter (where a.correct) as c, count(*) as t
               from public.analysis_answers(p_exam) a group by a.seat_no, a.indicator_id),
       ind as (select x.indicator_id, min(x.base_position) as first_pos, count(*)::int as item_count from exam_items x where x.exam_id = p_exam group by x.indicator_id)
  select jsonb_build_object(
    'n', (select count(*) from sc),
    'student_count', e.student_count, 'item_count', e.item_count,
    'mean', (select round(avg(score), 2) from sc),
    'sd', (select case when count(*) = 1 then 0 else round(stddev_samp(score), 2) end from sc),
    'median', (select percentile_cont(0.5) within group (order by score) from sc),
    'min', (select min(score) from sc), 'max', (select max(score) from sc),
    'mean_percent', (select round(100 * avg(score) / nullif(e.item_count, 0), 2) from sc),
    'histogram', (select jsonb_agg(coalesce(h.c, 0) order by b.k) from generate_series(0, 9) b(k)
                  left join (select least(9, floor(round(100.0 * score / e.item_count, 2) / 10))::int as k, count(*)::int as c from sc group by 1) h on h.k = b.k),
    'pass_ratio', v_pass,
    'indicators', (select coalesce(jsonb_agg(jsonb_build_object(
                      'indicator_id', ind.indicator_id, 'item_count', ind.item_count,
                      'pass_count', (select count(*) from per where per.indicator_id = ind.indicator_id and per.c >= v_pass * per.t),
                      'mean_ratio', (select round(sum(per.c)::numeric / nullif(sum(per.t), 0), 3) from per where per.indicator_id = ind.indicator_id))
                    order by ind.first_pos), '[]'::jsonb) from ind))
  into v;
  return v;
end $$;

-- ---------- ปิดชุด / หมดอายุ (ใช้ภายใน) ----------
--   1) รวมสถิติรายข้อเข้าคลัง (เฉพาะข้อที่มีผู้ตอบ) — ผูกกับเวอร์ชันของข้อที่ใช้ในชุดนี้
--   2) เก็บผลสรุประดับห้อง  3) ลบข้อมูลรายเลขที่ทั้งหมด  4) เปลี่ยนสถานะ
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
  delete from responses where exam_id = p_exam;
  get diagnostics v_deleted = row_count;
  v_summary := v_summary || jsonb_build_object('items_recorded', v_rows, 'responses_deleted', v_deleted, 'finalized_as', p_status, 'finalized_at', now());
  update exams set status = p_status, closed_at = now(), closed_summary = v_summary where id = p_exam;
  return v_summary;
end $$;

-- ครูกดปิดชุด (หน้าเว็บให้ดาวน์โหลดรายงานฉบับสุดท้ายก่อน)
create or replace function public.exam_close(p_exam uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is null or not public.app_owns_exam(p_exam) then raise exception 'ไม่พบชุดข้อสอบ'; end if;
  select status into v_status from exams where id = p_exam;
  if v_status = 'draft' then raise exception 'ชุดข้อสอบนี้ยังไม่ได้เริ่มตรวจ — ถ้าไม่ใช้แล้วให้ลบชุดแทน'; end if;
  return public.exam_finalize(p_exam, 'closed');
end $$;

-- ชุดที่ครบกำหนดหมดอายุ → รวมสถิติ ลบข้อมูลรายเลขที่ (เรียกได้ทุกคน ทำเฉพาะชุดที่ครบกำหนดจริง)
create or replace function public.exam_expire_due()
returns int language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_count int := 0;
begin
  for v_id in select id from exams where status in ('draft', 'open') and expires_at is not null and expires_at <= now() order by expires_at loop
    perform public.exam_finalize(v_id, 'expired');
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------- รายละเอียดชุดข้อสอบ (เพิ่มวันเริ่มตรวจ/ปิด/หมดอายุ ผลสรุปหลังปิด และสถิติรายข้อที่บันทึกเข้าคลัง) ----------
create or replace function public.exam_get(p_exam uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is not null and not public.app_owns_exam(p_exam) then raise exception 'ไม่พบชุดข้อสอบ'; end if;
  select jsonb_build_object(
    'id', e.id, 'title', e.title, 'grade_id', e.grade_id, 'item_count', e.item_count, 'set_count', e.set_count,
    'student_count', e.student_count, 'status', e.status, 'duration_min', e.duration_min, 'template_version', e.template_version, 'created_at', e.created_at, 'build_params', e.build_params,
    'opened_at', e.opened_at, 'closed_at', e.closed_at, 'expires_at', e.expires_at, 'closed_summary', e.closed_summary,
    'items', (select jsonb_agg(jsonb_build_object(
                 'item_id', x.item_id, 'item_code', i.item_code, 'version', x.item_version, 'base_position', x.base_position,
                 'indicator_id', x.indicator_id, 'difficulty', x.difficulty_at_build, 'is_anchor', x.is_anchor,
                 'no_shuffle', i.no_shuffle, 'n', coalesce(st.n, 0), 'content', v.content, 'answer', (v.answer->>'choice')::int)
                 order by x.base_position)
              from exam_items x join items i on i.id = x.item_id
              join item_versions v on v.item_id = x.item_id and v.version = x.item_version
              left join item_stats st on st.item_id = x.item_id
              where x.exam_id = e.id),
    'sets', (select jsonb_agg(jsonb_build_object('set_no', sn.set_no, 'entries',
                (select jsonb_agg(jsonb_build_object('position', s.position, 'item_id', s.item_id, 'option_order', to_jsonb(s.option_order),
                                   'key', array_position(s.option_order, (v.answer->>'choice')::smallint)) order by s.position)
                 from exam_set_items s join exam_items x on x.exam_id = s.exam_id and x.item_id = s.item_id
                 join item_versions v on v.item_id = s.item_id and v.version = x.item_version
                 where s.exam_id = e.id and s.set_no = sn.set_no)) order by sn.set_no)
             from (select distinct set_no from exam_set_items where exam_id = e.id) sn),
    'seats', (select coalesce(jsonb_agg(jsonb_build_object('seat_no', seat_no, 'set_no', set_no) order by seat_no), '[]'::jsonb)
              from exam_seats where exam_id = e.id),
    'has_responses', exists (select 1 from responses where exam_id = e.id),
    'round_stats', (select coalesce(jsonb_agg(jsonb_build_object('item_id', s.item_id, 'version', s.version, 'n', s.n, 'n_correct', s.n_correct,
                       'r', s.r, 'option_counts', s.option_counts) order by x.base_position), '[]'::jsonb)
                    from item_stat_rounds s join exam_items x on x.exam_id = e.id and x.item_id = s.item_id
                    where s.source_exam_id = e.id))
  into v
  from exams e where e.id = p_exam;
  if v is null then raise exception 'ไม่พบชุดข้อสอบ'; end if;
  return v;
end $$;

-- ลบชุด: ยังไม่เริ่มสอบ (ไม่มีคำตอบ) หรือปิด/หมดอายุแล้ว (สถิติเข้าคลังไปแล้ว ไม่หายตามชุด)
create or replace function public.exam_delete(p_exam uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is not null and not public.app_owns_exam(p_exam) then raise exception 'ไม่พบชุดข้อสอบ'; end if;
  select status into v_status from exams where id = p_exam;
  if v_status is null then raise exception 'ไม่พบชุดข้อสอบ'; end if;
  if v_status = 'open' or (v_status = 'draft' and exists (select 1 from responses where exam_id = p_exam)) then
    raise exception 'ลบได้เฉพาะชุดที่ยังไม่เริ่มสอบหรือปิดชุดแล้ว — ชุดนี้กำลังสอบ ให้ปิดชุดก่อน';
  end if;
  delete from exams where id = p_exam;
end $$;

-- ---------- สิทธิ์ ----------
revoke execute on function public.analysis_answers(uuid) from public, anon, authenticated;
revoke execute on function public.analysis_item_stats(uuid) from public, anon, authenticated;
revoke execute on function public.analysis_summary(uuid) from public, anon, authenticated;
revoke execute on function public.exam_finalize(uuid, text) from public, anon, authenticated;
revoke execute on function public.exam_close(uuid) from public, anon;
revoke execute on function public.exam_expire_due() from public, anon;
grant execute on function public.exam_close(uuid) to authenticated;
grant execute on function public.exam_expire_due() to authenticated;

-- ---------- ตั้งเวลาทุกวัน 02:15 น. (เวลาไทย) ด้วย pg_cron ถ้าเซิร์ฟเวอร์มี ----------
--   ไม่มี pg_cron ก็ยังหมดอายุได้: หน้าเว็บเรียก exam_expire_due ทุกครั้งที่เปิดรายการชุดข้อสอบ
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('itembank-expire-exams', '15 19 * * *', 'select public.exam_expire_due()');
      raise notice 'ตั้งเวลาลบข้อมูลหมดอายุทุกวันด้วย pg_cron แล้ว';
    exception when others then
      raise notice 'ตั้งเวลา pg_cron ไม่ได้ (%): ใช้การตรวจเมื่อเปิดรายการชุดข้อสอบแทน', sqlerrm;
    end;
  end if;
end $$;

commit;
