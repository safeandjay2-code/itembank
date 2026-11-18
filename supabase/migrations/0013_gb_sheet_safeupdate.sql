-- =====================================================================
-- 0013_gb_sheet_safeupdate.sql — แก้สมุดคะแนนเปิดไม่ได้ ("UPDATE requires a WHERE clause")
-- Supabase เปิด pg_safeupdate กับคำสั่งที่มาจาก API: UPDATE/DELETE ที่ไม่มี WHERE ถูกปฏิเสธ
-- gb_sheet (0011) มี "update _gb_cell set value = ..." บนตารางชั่วคราวโดยไม่มี WHERE → เพิ่ม "where true"
-- เนื้อฟังก์ชันอื่นเหมือน 0011 ทุกตัวอักษร · create or replace คงสิทธิ์ execute เดิม
-- =====================================================================
begin;
select public.app_begin_migration('0013', 'gb_sheet: add WHERE to temp-table update (pg_safeupdate)');

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
  update _gb_cell set value = round(coalesce(adjusted, real), v_digits) where true;

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


commit;
