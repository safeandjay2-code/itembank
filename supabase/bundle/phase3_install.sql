-- ติดตั้งเฟส 3 บน Supabase (SQL Editor) — เนื้อหาเดียวกับ supabase/migrations/0006_assembly.sql
-- =====================================================================
-- 0006_assembly.sql — เฟส 3 ประกอบชุดข้อสอบ (SPEC §6)
--   * assembly_pool  : รายการข้อพร้อมใช้ (ข้อมูลย่อ ไม่มีโจทย์) ให้หน้าเว็บเลือกข้อและสลับ
--   * exam_create    : บันทึกชุดข้อสอบ — ฐานข้อมูลตรวจกฎซ้ำทั้งหมด ไม่เชื่อหน้าเว็บ
--       ข้อพร้อมใช้และเป็นเวอร์ชันปัจจุบัน · จำนวนต่อตัวชี้วัด/ระดับตรงคำขอ · ลำดับมาตรฐานตามหลักสูตร ง่าย→ยาก
--       · ทุกชุดใช้ข้อเดียวกัน สลับเฉพาะในกลุ่มตัวชี้วัด+ระดับ · ตัวเลือกเป็นการเรียงสับเปลี่ยน ข้อห้ามสลับคงเดิม
--       · เฉลยแต่ละชุดกระจาย 1–4 สมดุลที่สุดเท่าที่ทำได้ · ป้ายข้อยึดค่าและชุดตามเลขที่คำนวณที่ฐานข้อมูลเอง
--   * exam_get       : รายละเอียดชุด (เนื้อหาข้อ เฉลยรายชุด เลขที่) เฉพาะเจ้าของชุด — ครูทั่วไปเห็นเฉพาะข้อในชุดตัวเอง (§12)
--   * exam_delete    : ลบชุดที่ยังไม่มีคำตอบ
--   * ข้อที่ถูกใช้ในชุดเปลี่ยนจาก "ตรวจแล้ว" เป็น "ใช้งาน"
--   * bank_remove_sample_items ลบชุดทดสอบที่ใช้ข้อหุ่นก่อน (ไม่เช่นนั้นลบข้อหุ่นไม่ได้)
-- =====================================================================
begin;
select public.app_begin_migration('0006', 'assembly: pool, exam_create with server-side rule checks, exam_get, exam_delete');

-- ---------- ตั้งค่าใหม่ ----------
insert into public.app_settings(key, value, description_th) values
  ('assembly.max_students', '60'::jsonb, 'จำนวนนักเรียน (เลขที่) สูงสุดต่อชุดข้อสอบ'),
  ('assembly.no_shuffle_warn_ratio', '0.3'::jsonb, 'เตือนเมื่อข้อห้ามสลับตัวเลือกเกินสัดส่วนนี้ของชุด'),
  ('assembly.similarity_warn_ratio', '0.5'::jsonb, 'เตือนเมื่อ 2 ชุดมีข้อและเฉลยตรงตำแหน่งกันเกินสัดส่วนนี้'),
  ('assembly.max_answer_run', '3'::jsonb, 'พยายามไม่ให้เฉลยตัวเลือกเดียวกันติดกันเกินจำนวนนี้')
on conflict (key) do nothing;

create or replace function public.app_setting_num(p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::numeric from public.app_settings
                   where key = p_key and jsonb_typeof(value) = 'number'), p_default)
$$;

-- ลำดับความยาก: ง่าย → ท้าทาย (เส้นแบ่ง p มาก → น้อย) เป็นข้อมูล ไม่ fix ในโค้ด
create or replace view public.difficulty_rank with (security_invoker = true) as
select id, row_number() over (order by p_lower desc, id) as rank from public.difficulty_levels;

-- ---------- ข้อพร้อมใช้สำหรับประกอบชุด ----------
create or replace function public.assembly_pool(p_subject_id text default 'MATH')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is not null and public.app_current_role() is null then
    raise exception 'ไม่มีสิทธิ์สร้างชุดข้อสอบ';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'item_code', i.item_code, 'indicator_id', i.indicator_id, 'difficulty', i.current_difficulty,
           'version', i.current_version, 'n', coalesce(st.n, 0), 'no_shuffle', i.no_shuffle,
           'answer', (v2.answer->>'choice')::int, 'is_sample', i.is_sample) order by i.item_code), '[]'::jsonb)
    into v
  from public.items i
  join public.indicators ind on ind.id = i.indicator_id and ind.active and ind.kind = 'terminal'
  join public.item_versions v2 on v2.item_id = i.id and v2.version = i.current_version
  left join public.item_stats st on st.item_id = i.id
  where i.subject_id = p_subject_id and i.status in ('reviewed', 'active') and i.item_type = 'mcq4';
  return v;
end $$;

-- การกระจายเฉลยที่ดีที่สุดเมื่อมีจำนวนตายตัว (ข้อห้ามสลับ) และเติมได้อีก m ข้อ → ค่าต่างสูงสุด−ต่ำสุด
create or replace function public.assembly_best_spread(p_fixed int[], p_m int)
returns int language plpgsql immutable as $$
declare c int[] := p_fixed; k int; i int; mi int;
begin
  for k in 1..coalesce(p_m, 0) loop
    mi := 1;
    for i in 2..array_length(c, 1) loop
      if c[i] < c[mi] then mi := i; end if;
    end loop;
    c[mi] := c[mi] + 1;
  end loop;
  return (select max(x) - min(x) from unnest(c) x);
end $$;

-- ---------- บันทึกชุดข้อสอบ ----------
create or replace function public.exam_create(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_title text := btrim(coalesce(p->>'title', ''));
  v_subject text := p->>'subject_id';
  v_grade text := p->>'grade_id';
  v_sets int; v_students int; v_n int;
  v_max_sets int := public.app_setting_num('assembly.max_sets', 10);
  v_max_students int := public.app_setting_num('assembly.max_students', 60);
  v_anchor_n int := public.app_setting_num('assembly.anchor_min_n', 50);
  v_bad text; v_exam uuid; v_fixed int[]; v_m int; v_best int; r record;
begin
  if v_uid is null then raise exception 'ต้องเข้าสู่ระบบก่อนสร้างชุดข้อสอบ'; end if;
  if public.app_current_role() is null then raise exception 'ไม่มีสิทธิ์สร้างชุดข้อสอบ'; end if;
  if v_title = '' or length(v_title) > 200 then raise exception 'ชื่อแบบทดสอบต้องมี 1–200 ตัวอักษร'; end if;
  if not exists (select 1 from subjects where id = v_subject) then raise exception 'ไม่รู้จักวิชา %', v_subject; end if;
  if not exists (select 1 from grades where id = v_grade) then raise exception 'ไม่รู้จักชั้น %', v_grade; end if;
  begin
    v_sets := (p->>'set_count')::int; v_students := (p->>'student_count')::int;
  exception when others then raise exception 'จำนวนชุด/จำนวนนักเรียนไม่ถูกต้อง'; end;
  if v_sets is null or v_sets < 1 or v_sets > least(v_max_sets, 10) then raise exception 'จำนวนชุดต้องอยู่ระหว่าง 1–%', least(v_max_sets, 10); end if;
  if v_students is null or v_students < 1 or v_students > v_max_students then raise exception 'จำนวนนักเรียนต้องอยู่ระหว่าง 1–%', v_max_students; end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_typeof(p->'sets') is distinct from 'array'
     or jsonb_typeof(p->'rows') is distinct from 'array' then
    raise exception 'ข้อมูลชุดข้อสอบไม่ครบ (items/sets/rows)';
  end if;

  create temp table if not exists _ec_items (item_id uuid, version int, base_position int) on commit drop;
  create temp table if not exists _ec_rows (indicator_id text, difficulty int, cnt int) on commit drop;
  create temp table if not exists _ec_sets (set_no int, position int, item_id uuid, option_order smallint[]) on commit drop;
  truncate _ec_items, _ec_rows, _ec_sets;

  insert into _ec_items select x.item_id, x.version, x.base_position
    from jsonb_to_recordset(p->'items') as x(item_id uuid, version int, base_position int);
  insert into _ec_rows select x.indicator_id, x.difficulty, sum(x.count)
    from jsonb_to_recordset(p->'rows') as x(indicator_id text, difficulty int, count int) group by 1, 2;
  insert into _ec_sets
    select (s->>'set_no')::int, e.ord::int, (e.val->>'item_id')::uuid,
           array(select o::smallint from jsonb_array_elements_text(e.val->'option_order') o)
    from jsonb_array_elements(p->'sets') s, jsonb_array_elements(s->'entries') with ordinality e(val, ord);

  -- ข้อในชุด: ไม่ซ้ำ ตำแหน่งมาตรฐาน 1..N
  select count(*) into v_n from _ec_items;
  if v_n < 1 then raise exception 'ชุดข้อสอบต้องมีอย่างน้อย 1 ข้อ'; end if;
  if (select count(distinct item_id) from _ec_items) <> v_n then raise exception 'มีข้อซ้ำในชุดข้อสอบ'; end if;
  if (select count(distinct base_position) from _ec_items where base_position between 1 and v_n) <> v_n then
    raise exception 'ลำดับมาตรฐานของข้อต้องเป็น 1–% ไม่ซ้ำ', v_n;
  end if;

  -- ข้อพร้อมใช้ (ตรวจแล้ว/ใช้งาน) เวอร์ชันปัจจุบัน ของวิชานี้
  select string_agg(coalesce(i.item_code, x.item_id::text), ', ') into v_bad
  from _ec_items x left join items i on i.id = x.item_id
  where i.id is null or i.subject_id <> v_subject or i.status not in ('reviewed', 'active') or i.item_type <> 'mcq4';
  if v_bad is not null then raise exception 'ข้อ % ไม่อยู่ในสถานะพร้อมใช้ (ตรวจแล้ว/ใช้งาน)', v_bad; end if;
  select string_agg(i.item_code, ', ') into v_bad
  from _ec_items x join items i on i.id = x.item_id where x.version is distinct from i.current_version;
  if v_bad is not null then raise exception 'ข้อ % ถูกแก้ไขระหว่างสร้างชุด กรุณาสร้างใหม่', v_bad; end if;

  -- จำนวนต่อตัวชี้วัด × ระดับ ตรงกับคำขอ (§6.1 ข้อ 3)
  select string_agg(coalesce(a.indicator_id, b.indicator_id) || '/' || coalesce(a.difficulty, b.difficulty), ', ') into v_bad
  from (select i.indicator_id, i.current_difficulty as difficulty, count(*)::int as cnt
          from _ec_items x join items i on i.id = x.item_id group by 1, 2) a
  full join _ec_rows b on a.indicator_id = b.indicator_id and a.difficulty = b.difficulty
  where coalesce(a.cnt, 0) <> coalesce(b.cnt, 0);
  if v_bad is not null then raise exception 'จำนวนข้อไม่ตรงกับที่เลือก: %', v_bad; end if;

  -- ลำดับมาตรฐาน: ตัวชี้วัดตามหลักสูตร แล้วง่าย→ท้าทาย (§6.3 ข้อ 1–2)
  if exists (
    select 1 from (
      select g.sort as gs, ind.sort as isort, dr.rank as dr,
             lag(g.sort) over w as pgs, lag(ind.sort) over w as pis, lag(dr.rank) over w as pdr
      from _ec_items x join items i on i.id = x.item_id
      join indicators ind on ind.id = i.indicator_id join grades g on g.id = ind.grade_id
      join difficulty_rank dr on dr.id = i.current_difficulty
      window w as (order by x.base_position)) t
    where (pgs, pis, pdr) > (gs, isort, dr)) then
    raise exception 'ลำดับข้อต้องเรียงตามตัวชี้วัดในหลักสูตร และง่าย→ยากภายในตัวชี้วัด';
  end if;

  -- ทุกชุด: ครบ 1..S, ข้อชุดเดียวกัน, สลับเฉพาะในกลุ่ม
  if (select count(distinct set_no) from _ec_sets where set_no between 1 and v_sets) <> v_sets
     or exists (select 1 from _ec_sets where set_no not between 1 and v_sets)
     or jsonb_array_length(p->'sets') <> v_sets then
    raise exception 'ต้องมีลำดับข้อครบทุกชุด 1–%', v_sets;
  end if;
  if exists (select 1 from _ec_sets group by set_no having count(*) <> v_n or count(distinct item_id) <> v_n)
     or exists (select 1 from _ec_sets s where not exists (select 1 from _ec_items x where x.item_id = s.item_id)) then
    raise exception 'ทุกชุดต้องใช้ข้อชุดเดียวกัน ครบทุกข้อ ไม่ซ้ำ';
  end if;
  if exists (
    select 1 from _ec_sets s
    join items si on si.id = s.item_id
    join _ec_items bx on bx.base_position = s.position join items bi on bi.id = bx.item_id
    where si.indicator_id <> bi.indicator_id or si.current_difficulty <> bi.current_difficulty) then
    raise exception 'สลับลำดับข้อได้เฉพาะภายในกลุ่มตัวชี้วัดและระดับเดียวกัน';
  end if;

  -- ตัวเลือก: เรียงสับเปลี่ยนของ 1–4, ข้อห้ามสลับต้องคงเดิม
  if exists (select 1 from _ec_sets
             where coalesce(array_length(option_order, 1), 0) <> 4
                or (select array_agg(o order by o) from unnest(option_order) o) <> '{1,2,3,4}'::smallint[]) then
    raise exception 'ลำดับตัวเลือกต้องเป็นการสลับของตัวเลือก 1–4';
  end if;
  select string_agg(distinct i.item_code, ', ') into v_bad
  from _ec_sets s join items i on i.id = s.item_id
  where i.no_shuffle and s.option_order <> '{1,2,3,4}'::smallint[];
  if v_bad is not null then raise exception 'ข้อ % ห้ามสลับตัวเลือก', v_bad; end if;

  -- เฉลยแต่ละชุดต้องกระจายสมดุลที่สุดเท่าที่ข้อห้ามสลับยอมให้ (§6.3 ข้อ 5)
  select array[count(*) filter (where a = 1), count(*) filter (where a = 2), count(*) filter (where a = 3), count(*) filter (where a = 4)]::int[],
         0
    into v_fixed, v_m
  from (select (v.answer->>'choice')::int as a from _ec_items x join items i on i.id = x.item_id
        join item_versions v on v.item_id = i.id and v.version = i.current_version where i.no_shuffle) t;
  select count(*) into v_m from _ec_items x join items i on i.id = x.item_id where not i.no_shuffle;
  v_best := public.assembly_best_spread(v_fixed, v_m);
  for r in
    select s.set_no, max(c) - min(c) as spread
    from (select s.set_no, k, count(t.key) as c
          from generate_series(1, v_sets) s(set_no) cross join generate_series(1, 4) k
          left join (select s2.set_no, array_position(s2.option_order, (v.answer->>'choice')::smallint) as key
                       from _ec_sets s2 join items i on i.id = s2.item_id
                       join item_versions v on v.item_id = i.id and v.version = i.current_version) t
                 on t.set_no = s.set_no and t.key = k
          group by s.set_no, k) s
    group by s.set_no
  loop
    if r.spread > v_best then
      raise exception 'เฉลยชุดที่ % กระจายไม่สมดุล (ต่างกัน % ข้อ ควรไม่เกิน %)', r.set_no, r.spread, v_best;
    end if;
  end loop;

  -- ---------- บันทึก ----------
  insert into exams(owner_id, title, subject_id, grade_id, item_count, set_count, student_count, status, template_version, build_params)
  values (v_uid, v_title, v_subject, v_grade, v_n, v_sets, v_students, 'draft',
          (select max(version) from answer_sheet_templates where active),
          jsonb_build_object('rows', (select jsonb_agg(jsonb_build_object('indicator_id', indicator_id, 'difficulty', difficulty, 'count', cnt)
                                                       order by indicator_id, difficulty) from _ec_rows),
                             'build', coalesce(p->'build', '{}'::jsonb),
                             'anchor_min_n', v_anchor_n))
  returning id into v_exam;

  insert into exam_items(exam_id, item_id, item_version, base_position, indicator_id, difficulty_at_build, is_anchor)
  select v_exam, i.id, i.current_version, x.base_position, i.indicator_id, i.current_difficulty, coalesce(st.n, 0) >= v_anchor_n
  from _ec_items x join items i on i.id = x.item_id left join item_stats st on st.item_id = i.id;

  insert into exam_set_items(exam_id, set_no, position, item_id, option_order)
  select v_exam, set_no, position, item_id, option_order from _ec_sets;

  -- เลขที่ → ชุด แบบวนรอบ (§6.4) คำนวณที่นี่ ไม่รับจากหน้าเว็บ
  insert into exam_seats(exam_id, seat_no, set_no)
  select v_exam, s, ((s - 1) % v_sets) + 1 from generate_series(1, v_students) s;

  -- ข้อที่ถูกใช้ในชุด: ตรวจแล้ว → ใช้งาน
  update items i set status = 'active'
  where i.id in (select item_id from _ec_items) and i.status = 'reviewed'
    and (i.is_sample or coalesce((select (v.qa->>'passed')::boolean from item_versions v
                                  where v.item_id = i.id and v.version = i.current_version), false));
  return v_exam;
end $$;

-- ---------- รายละเอียดชุดข้อสอบ ----------
create or replace function public.exam_get(p_exam uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is not null and not public.app_owns_exam(p_exam) then raise exception 'ไม่พบชุดข้อสอบ'; end if;
  select jsonb_build_object(
    'id', e.id, 'title', e.title, 'grade_id', e.grade_id, 'item_count', e.item_count, 'set_count', e.set_count,
    'student_count', e.student_count, 'status', e.status, 'created_at', e.created_at, 'build_params', e.build_params,
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
    'has_responses', exists (select 1 from responses where exam_id = e.id))
  into v
  from exams e where e.id = p_exam;
  if v is null then raise exception 'ไม่พบชุดข้อสอบ'; end if;
  return v;
end $$;

-- ---------- ลบชุดข้อสอบ (เฉพาะชุดที่ยังไม่มีคำตอบ) ----------
create or replace function public.exam_delete(p_exam uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is not null and not public.app_owns_exam(p_exam) then raise exception 'ไม่พบชุดข้อสอบ'; end if;
  select status into v_status from exams where id = p_exam;
  if v_status is null then raise exception 'ไม่พบชุดข้อสอบ'; end if;
  if v_status <> 'draft' or exists (select 1 from responses where exam_id = p_exam) then
    raise exception 'ลบได้เฉพาะชุดที่ยังไม่เริ่มสอบและยังไม่มีคำตอบ';
  end if;
  delete from exams where id = p_exam;
end $$;

-- ---------- ลบข้อหุ่น: ลบชุดทดสอบที่ใช้ข้อหุ่นก่อน ----------
create or replace function public.bank_remove_sample_items()
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not public.app_is_bank_admin() and auth.uid() is not null then
    raise exception 'ไม่มีสิทธิ์';
  end if;
  delete from public.exams where id in (select x.exam_id from public.exam_items x join public.items i on i.id = x.item_id where i.is_sample);
  delete from public.items where is_sample;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function public.assembly_pool(text) from public, anon;
revoke execute on function public.exam_create(jsonb) from public, anon;
revoke execute on function public.exam_get(uuid) from public, anon;
revoke execute on function public.exam_delete(uuid) from public, anon;
grant execute on function public.assembly_pool(text) to authenticated;
grant execute on function public.exam_create(jsonb) to authenticated;
grant execute on function public.exam_get(uuid) to authenticated;
grant execute on function public.exam_delete(uuid) to authenticated;

commit;
