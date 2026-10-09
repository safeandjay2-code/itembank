-- =====================================================================
-- 0005_bank_editing.sql — เฟส 2 คลังข้อสอบ: เพิ่ม/แก้/ค้นข้อ, เวอร์ชัน, สถานะ,
-- ผลตรวจคุณภาพอัตโนมัติ, สำรอง/นำเข้า JSON
-- กฎ (SPEC §5.4, §5.6, §3.10):
--   * แก้คำผิด/รูปแบบ = เวอร์ชันเดิม (สถิติคงเดิม) — ฐานข้อมูลปฏิเสธถ้าตัวเลข เฉลย หรือรูปเปลี่ยน
--   * แก้สาระสำคัญ = เวอร์ชันใหม่ สถิติเริ่มนับใหม่ และกลับเป็น "ร่าง" ให้ตรวจใหม่
--   * ตั้งเป็น "ตรวจแล้ว/ใช้งาน" ได้เมื่อเวอร์ชันปัจจุบันผ่านการตรวจอัตโนมัติเท่านั้น
--   * สำรองคลังเป็น JSON มาตรฐาน (itembank.bank.v1) และนำกลับเข้าได้
-- =====================================================================
begin;
select public.app_begin_migration('0005', 'bank editing: save/version/status/qa, item list view, json export/import');

-- ---------- คอลัมน์เพิ่ม ----------
alter table public.items add column subtopic text;                 -- หัวข้อย่อย (SPEC §5.3)
alter table public.item_versions add column qa jsonb;              -- ผลตรวจคุณภาพอัตโนมัติของเวอร์ชันนี้

-- ---------- ตั้งค่าใหม่ ----------
insert into public.app_settings(key, value, description_th) values
  ('qa.require_answer_check', 'false'::jsonb, 'บังคับให้ทุกข้อมีนิพจน์คำนวณเฉลยซ้ำ (true/false)')
on conflict (key) do nothing;

-- ---------- ตัวช่วย ----------
create or replace function public.bank_require_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  -- auth.uid() เป็น null เมื่อรันจาก SQL Editor ของผู้ดูแลฐานข้อมูล
  if auth.uid() is not null and not public.app_is_bank_admin() then
    raise exception 'ไม่มีสิทธิ์จัดการคลังข้อสอบ';
  end if;
end $$;

-- ลายเซ็นตัวเลขในข้อความ (ตรงกับ digitSignature ในหน้าเว็บ)
create or replace function public.bank_digits(t text)
returns text language sql immutable as $$
  select coalesce(string_agg(m[1], '|' order by ord), '')
  from regexp_matches(coalesce(t, ''), '(\d+(?:[.,]\d+)*)', 'g') with ordinality as r(m, ord)
$$;

-- เหตุผลที่การแก้ไขต้องขึ้นเวอร์ชันใหม่ (ว่าง = แก้แบบเวอร์ชันเดิมได้)
create or replace function public.bank_major_edit_reasons(old_c jsonb, old_a jsonb, new_c jsonb, new_a jsonb)
returns text[] language plpgsql immutable as $$
declare
  r text[] := '{}';
  i int;
  n_old int := coalesce(jsonb_array_length(old_c->'options'), 0);
  n_new int := coalesce(jsonb_array_length(new_c->'options'), 0);
begin
  if (old_a->'choice') is distinct from (new_a->'choice') then r := r || 'เปลี่ยนเฉลย'; end if;
  if n_old <> n_new then
    r := r || 'จำนวนตัวเลือกเปลี่ยน';
  else
    for i in 0 .. n_old - 1 loop
      if public.bank_digits(old_c->'options'->>i) <> public.bank_digits(new_c->'options'->>i) then
        r := r || format('ตัวเลขในตัวเลือก %s เปลี่ยน', i + 1);
      end if;
    end loop;
  end if;
  if public.bank_digits(old_c->>'stem') <> public.bank_digits(new_c->>'stem') then r := r || 'ตัวเลขในโจทย์เปลี่ยน'; end if;
  if coalesce(old_c->'figure', 'null'::jsonb) is distinct from coalesce(new_c->'figure', 'null'::jsonb) then
    r := r || 'รูปเปลี่ยน';
  end if;
  return r;
end $$;

-- ตรวจโครงสร้างเนื้อหาขั้นต่ำ (ตรวจละเอียดทำในหน้าเว็บ แล้วส่งผลมาใน qa)
create or replace function public.bank_validate_content(p_type text, p_content jsonb, p_answer jsonb)
returns void language plpgsql stable set search_path = public as $$
declare v_t public.item_types; v_choice int;
begin
  select * into v_t from public.item_types where key = p_type;
  if not found then raise exception 'ไม่รู้จักประเภทข้อ %', p_type; end if;
  if jsonb_typeof(p_content) <> 'object' then raise exception 'เนื้อหาข้อสอบต้องเป็นออบเจกต์ JSON'; end if;
  if coalesce(btrim(p_content->>'stem'), '') = '' then raise exception 'ยังไม่มีโจทย์'; end if;
  if v_t.response_kind = 'choice' then
    if jsonb_typeof(p_content->'options') <> 'array' or jsonb_array_length(p_content->'options') <> v_t.option_count then
      raise exception 'ข้อประเภท % ต้องมีตัวเลือก % ตัว', v_t.name_th, v_t.option_count;
    end if;
    if jsonb_typeof(p_answer->'choice') <> 'number' then raise exception 'ยังไม่ได้เลือกเฉลย'; end if;
    v_choice := (p_answer->>'choice')::int;
    if v_choice < 1 or v_choice > v_t.option_count then raise exception 'เฉลยต้องเป็นตัวเลือก 1–%', v_t.option_count; end if;
  end if;
  if p_content ? 'figure' and jsonb_typeof(p_content->'figure') not in ('object', 'null') then
    raise exception 'ข้อกำหนดรูปต้องเป็นออบเจกต์ JSON';
  end if;
end $$;

-- แปลงระดับ (id ตัวเลข / key / ชื่อไทย) → id
create or replace function public.bank_level_id(p_kind text, p_val jsonb)
returns smallint language plpgsql stable set search_path = public as $$
declare v smallint;
begin
  if p_val is null or jsonb_typeof(p_val) = 'null' then raise exception 'ยังไม่ระบุ%', case p_kind when 'cognitive' then 'ระดับการคิด' else 'ระดับความยาก' end; end if;
  if p_kind = 'cognitive' then
    select id into v from public.cognitive_levels
     where (jsonb_typeof(p_val) = 'number' and id = (p_val #>> '{}')::smallint)
        or (jsonb_typeof(p_val) = 'string' and (key = p_val #>> '{}' or name_th = p_val #>> '{}'));
  else
    select id into v from public.difficulty_levels
     where (jsonb_typeof(p_val) = 'number' and id = (p_val #>> '{}')::smallint)
        or (jsonb_typeof(p_val) = 'string' and (key = p_val #>> '{}' or name_th = p_val #>> '{}'));
  end if;
  if v is null then raise exception 'ไม่รู้จัก%: %', case p_kind when 'cognitive' then 'ระดับการคิด' else 'ระดับความยาก' end, p_val #>> '{}'; end if;
  return v;
end $$;

-- ---------- ต้องผ่านการตรวจอัตโนมัติก่อนเป็น "ตรวจแล้ว/ใช้งาน" (SPEC §5.6) ----------
create or replace function public.tg_items_guard_qa()
returns trigger language plpgsql as $$
begin
  if new.status in ('reviewed', 'active') and not new.is_sample
     and (new.status is distinct from old.status or new.current_version <> old.current_version) then
    if not coalesce((select (qa->>'passed')::boolean from public.item_versions
                      where item_id = new.id and version = new.current_version), false) then
      raise exception 'ข้อ % ยังไม่ผ่านการตรวจอัตโนมัติ จึงตั้งเป็น "ตรวจแล้ว/ใช้งาน" ไม่ได้', new.item_code;
    end if;
  end if;
  return new;
end $$;
create trigger items_guard_qa before update on public.items
  for each row execute function public.tg_items_guard_qa();

-- ---------- บันทึกข้อ (สร้างใหม่ / แก้เวอร์ชันเดิม / ขึ้นเวอร์ชันใหม่) ----------
create or replace function public.bank_save_item(p_item jsonb, p_mode text, p_change_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_item public.items;
  v_cur public.item_versions;
  v_type text := coalesce(nullif(p_item->>'item_type', ''), 'mcq4');
  v_ind public.indicators;
  v_cog smallint := public.bank_level_id('cognitive', p_item->'cognitive_level');
  v_est smallint := public.bank_level_id('difficulty', p_item->'est_difficulty');
  v_qa_ok boolean := coalesce((p_item->'qa'->>'passed')::boolean, false);
  v_reasons text[];
  v_status text;
  v_version int;
  v_tags text[] := coalesce((select array_agg(t) from jsonb_array_elements_text(coalesce(p_item->'tags', '[]'::jsonb)) t), '{}');
  v_no_shuffle boolean := coalesce((p_item->>'no_shuffle')::boolean, false);
  v_subtopic text := nullif(btrim(p_item->>'subtopic'), '');
begin
  perform public.bank_require_admin();
  if not exists (select 1 from public.item_types where key = v_type and active) then
    raise exception 'ประเภทข้อ % ยังไม่เปิดใช้งาน', v_type;
  end if;
  select * into v_ind from public.indicators where id = p_item->>'indicator_id';
  if not found then raise exception 'ไม่พบตัวชี้วัด %', coalesce(p_item->>'indicator_id', '(ไม่ระบุ)'); end if;
  perform public.bank_validate_content(v_type, p_item->'content', p_item->'answer');

  if p_mode = 'new' then
    insert into public.items(owner_id, subject_id, indicator_id, item_type, cognitive_level, est_difficulty,
                             current_difficulty, status, no_shuffle, tags, subtopic)
    values (coalesce(auth.uid(), (select id from public.profiles where role = 'owner' order by created_at limit 1)),
            v_ind.subject_id, v_ind.id, v_type, v_cog, v_est, v_est, 'draft', v_no_shuffle, v_tags, v_subtopic)
    returning id into v_id;
    insert into public.item_versions(item_id, version, content, answer, qa, change_note)
    values (v_id, 1, p_item->'content', p_item->'answer', p_item->'qa', coalesce(p_change_note, 'สร้างข้อ'));
    return v_id;
  end if;

  v_id := (p_item->>'id')::uuid;
  select * into v_item from public.items where id = v_id for update;
  if not found then raise exception 'ไม่พบข้อสอบที่จะแก้ไข'; end if;
  if v_ind.subject_id <> v_item.subject_id then raise exception 'ย้ายข้อไปตัวชี้วัดของวิชาอื่นไม่ได้'; end if;
  if v_type <> v_item.item_type then raise exception 'เปลี่ยนประเภทข้อไม่ได้ ให้สร้างข้อใหม่แทน'; end if;
  select * into v_cur from public.item_versions where item_id = v_id and version = v_item.current_version;

  if p_mode = 'minor' then
    v_reasons := public.bank_major_edit_reasons(v_cur.content, v_cur.answer, p_item->'content', p_item->'answer');
    if cardinality(v_reasons) > 0 then
      raise exception 'การแก้ไขนี้ต้องขึ้นเวอร์ชันใหม่: %', array_to_string(v_reasons, ', ');
    end if;
    update public.item_versions set content = p_item->'content', qa = p_item->'qa'
     where item_id = v_id and version = v_item.current_version;
    insert into public.item_events(item_id, event_type, payload)
    values (v_id, 'version_edited', jsonb_build_object('version', v_item.current_version, 'note', p_change_note));
    v_version := v_item.current_version;
    v_status := case when not v_qa_ok and v_item.status in ('reviewed', 'active') then 'needs_fix' else v_item.status end;
  elsif p_mode = 'major' then
    v_version := v_item.current_version + 1;
    insert into public.item_versions(item_id, version, content, answer, qa, change_note)
    values (v_id, v_version, p_item->'content', p_item->'answer', p_item->'qa', p_change_note);
    v_status := 'draft';
  else
    raise exception 'โหมดบันทึกไม่ถูกต้อง: %', p_mode;
  end if;

  if (v_item.indicator_id, v_item.cognitive_level, v_item.est_difficulty, v_item.no_shuffle, coalesce(v_item.subtopic, ''))
     is distinct from (v_ind.id, v_cog, v_est, v_no_shuffle, coalesce(v_subtopic, '')) then
    insert into public.item_events(item_id, event_type, payload) values (v_id, 'meta_changed', jsonb_build_object(
      'from', jsonb_build_object('indicator_id', v_item.indicator_id, 'cognitive_level', v_item.cognitive_level,
                                 'est_difficulty', v_item.est_difficulty, 'no_shuffle', v_item.no_shuffle, 'subtopic', v_item.subtopic),
      'to',   jsonb_build_object('indicator_id', v_ind.id, 'cognitive_level', v_cog,
                                 'est_difficulty', v_est, 'no_shuffle', v_no_shuffle, 'subtopic', v_subtopic)));
  end if;

  update public.items set
    indicator_id = v_ind.id, cognitive_level = v_cog, est_difficulty = v_est,
    -- ยังไม่มีสถิติจริง → ความยากปัจจุบันตามค่าคาดการณ์; มีสถิติแล้วให้วงจรปรับความยากเป็นผู้ย้าย (เฟส 7)
    current_difficulty = case when exists (select 1 from public.item_stat_rounds where item_id = v_id)
                              then current_difficulty else v_est end,
    no_shuffle = v_no_shuffle, tags = v_tags, subtopic = v_subtopic,
    current_version = v_version, status = v_status
  where id = v_id;
  return v_id;
end $$;

-- ---------- เปลี่ยนสถานะ ----------
create or replace function public.bank_set_status(p_id uuid, p_status text, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
begin
  perform public.bank_require_admin();
  update public.items set status = p_status where id = p_id;
  if not found then raise exception 'ไม่พบข้อสอบ'; end if;
  if nullif(btrim(p_note), '') is not null then
    insert into public.item_events(item_id, event_type, payload) values (p_id, 'note', jsonb_build_object('text', p_note, 'status', p_status));
  end if;
  return p_status;
end $$;

-- ---------- ลบข้อ (เฉพาะร่างที่ยังไม่เคยใช้และไม่มีสถิติ; ข้ออื่นให้ "เลิกใช้" แทน) ----------
create or replace function public.bank_delete_item(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v public.items;
begin
  perform public.bank_require_admin();
  select * into v from public.items where id = p_id for update;
  if not found then raise exception 'ไม่พบข้อสอบ'; end if;
  if v.status <> 'draft' then raise exception 'ลบได้เฉพาะข้อที่เป็นร่าง ข้ออื่นให้เปลี่ยนเป็น "เลิกใช้"'; end if;
  if exists (select 1 from public.exam_items where item_id = p_id) then raise exception 'ข้อนี้เคยถูกใช้ในชุดข้อสอบแล้ว ลบไม่ได้'; end if;
  if exists (select 1 from public.item_stat_rounds where item_id = p_id) then raise exception 'ข้อนี้มีสถิติแล้ว ลบไม่ได้'; end if;
  delete from public.items where id = p_id;
  return true;
end $$;

-- ---------- มุมมองรายการข้อ (สำหรับหน้าค้นหา) ----------
create view public.bank_item_list with (security_invoker = true) as
select i.id, i.item_code, i.subject_id, i.indicator_id, ind.grade_id, ind.sort as indicator_sort, ind.code as indicator_code,
       i.item_type, i.cognitive_level, i.est_difficulty, i.current_difficulty, i.status, i.current_version,
       i.no_shuffle, i.is_sample, i.tags, i.subtopic,
       v.content->>'stem' as stem,
       coalesce(jsonb_typeof(v.content->'figure') = 'object', false) as has_figure,
       (v.qa->>'passed')::boolean as qa_passed,
       coalesce(st.n, 0) as n, st.p, st.r,
       i.created_at, i.updated_at
from public.items i
join public.indicators ind on ind.id = i.indicator_id
join public.item_versions v on v.item_id = i.id and v.version = i.current_version
left join public.item_stats st on st.item_id = i.id;

-- ---------- สำรองคลังเป็น JSON (SPEC §3.10, §12) ----------
create or replace function public.bank_export(p_subject_id text default 'MATH', p_include_samples boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.bank_require_admin();
  select jsonb_build_object(
    'format', 'itembank.bank.v1',
    'exported_at', now(),
    'subject_id', p_subject_id,
    'item_count', count(*),
    'items', coalesce(jsonb_agg(x.doc order by x.code), '[]'::jsonb))
  into v
  from (
    select i.item_code as code, jsonb_build_object(
      'item_code', i.item_code, 'subject_id', i.subject_id,
      'indicator_id', i.indicator_id, 'indicator_code', ind.code,
      'item_type', i.item_type, 'cognitive_level', cl.key,
      'est_difficulty', de.key, 'current_difficulty', dc.key,
      'status', i.status, 'current_version', i.current_version,
      'no_shuffle', i.no_shuffle, 'is_sample', i.is_sample, 'tags', to_jsonb(i.tags), 'subtopic', i.subtopic,
      'created_at', i.created_at,
      'versions', (select jsonb_agg(jsonb_build_object('version', iv.version, 'content', iv.content, 'answer', iv.answer,
                          'qa', iv.qa, 'change_note', iv.change_note, 'created_at', iv.created_at) order by iv.version)
                   from public.item_versions iv where iv.item_id = i.id),
      'stat_rounds', (select coalesce(jsonb_agg(jsonb_build_object('version', s.version, 'grade_id', s.grade_id, 'n', s.n,
                          'n_correct', s.n_correct, 'r', s.r, 'option_counts', s.option_counts, 'recorded_at', s.recorded_at)
                          order by s.recorded_at), '[]'::jsonb)
                      from public.item_stat_rounds s where s.item_id = i.id),
      'events', (select coalesce(jsonb_agg(jsonb_build_object('type', e.event_type, 'payload', e.payload, 'at', e.at) order by e.id), '[]'::jsonb)
                 from public.item_events e where e.item_id = i.id)
    ) as doc
    from public.items i
    join public.indicators ind on ind.id = i.indicator_id
    join public.cognitive_levels cl on cl.id = i.cognitive_level
    join public.difficulty_levels de on de.id = i.est_difficulty
    join public.difficulty_levels dc on dc.id = i.current_difficulty
    where i.subject_id = p_subject_id and (p_include_samples or not i.is_sample)
  ) x;
  return v;
end $$;

-- ---------- นำเข้าคลังจาก JSON ----------
-- มีรหัสข้อ = กู้คืนจากไฟล์สำรอง (คงรหัส เวอร์ชัน สถานะ สถิติ ประวัติ); รหัสซ้ำในคลัง = ข้าม
-- ไม่มีรหัสข้อ = ข้อใหม่ (เช่น ข้อที่ร่างด้วย AI) ได้รหัสใหม่และเป็น "ร่าง" เสมอ
-- p_dry_run = true: ตรวจอย่างเดียว ไม่บันทึกอะไร
create or replace function public.bank_import(p_data jsonb, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_it jsonb; v_idx int := 0; v_inserted int := 0;
  v_skipped jsonb := '[]'::jsonb; v_errors jsonb := '[]'::jsonb;
  v_code text; v_id uuid; v_ind public.indicators; v_type text; v_prefix text;
  v_cog smallint; v_est smallint; v_curd smallint; v_status text;
  v_versions jsonb; v_ver jsonb; v_maxver int; v_curver int; v_restore boolean;
  v_owner uuid := coalesce(auth.uid(), (select id from public.profiles where role = 'owner' order by created_at limit 1));
  v_next bigint; v_max bigint;
begin
  perform public.bank_require_admin();
  if p_data->>'format' is distinct from 'itembank.bank.v1' then
    raise exception 'รูปแบบไฟล์ไม่ถูกต้อง (ต้องเป็นไฟล์สำรองคลัง itembank.bank.v1)';
  end if;
  if jsonb_typeof(p_data->'items') <> 'array' then raise exception 'ไฟล์ไม่มีรายการข้อสอบ (items)'; end if;
  if v_owner is null then raise exception 'ยังไม่มีผู้ใช้บทบาท owner'; end if;

  begin
    for v_it in select value from jsonb_array_elements(p_data->'items') loop
      v_idx := v_idx + 1;
      v_code := nullif(btrim(v_it->>'item_code'), '');
      begin
        if jsonb_typeof(v_it) <> 'object' then raise exception 'รายการไม่ใช่ออบเจกต์ JSON'; end if;
        if v_code is not null and exists (select 1 from public.items where item_code = v_code) then
          v_skipped := v_skipped || jsonb_build_object('index', v_idx, 'item_code', v_code, 'reason', 'มีรหัสนี้ในคลังแล้ว');
          continue;
        end if;
        select * into v_ind from public.indicators
         where id = nullif(v_it->>'indicator_id', '')
            or (nullif(v_it->>'indicator_id', '') is null and code = v_it->>'indicator_code'
                and subject_id = coalesce(v_it->>'subject_id', p_data->>'subject_id', 'MATH') and active)
         order by curriculum_version desc limit 1;
        if not found then
          raise exception 'ไม่พบตัวชี้วัด %', coalesce(v_it->>'indicator_id', v_it->>'indicator_code', '(ไม่ระบุ)');
        end if;
        v_type := coalesce(nullif(v_it->>'item_type', ''), 'mcq4');
        v_cog := public.bank_level_id('cognitive', v_it->'cognitive_level');
        v_est := public.bank_level_id('difficulty', v_it->'est_difficulty');
        v_restore := v_code is not null;

        if v_restore then
          select code_prefix into v_prefix from public.subjects where id = v_ind.subject_id;
          if v_code !~ ('^' || v_prefix || '-[0-9]{6}$') then
            raise exception 'รหัสข้อ % ไม่ตรงรูปแบบ %-000000', v_code, v_prefix;
          end if;
          v_versions := case when jsonb_typeof(v_it->'versions') = 'array' and jsonb_array_length(v_it->'versions') > 0
                             then v_it->'versions'
                             else jsonb_build_array(jsonb_build_object('version', 1, 'content', v_it->'content',
                                                    'answer', v_it->'answer', 'qa', v_it->'qa')) end;
          v_status := coalesce(nullif(v_it->>'status', ''), 'draft');
          v_curd := case when v_it ? 'current_difficulty' then public.bank_level_id('difficulty', v_it->'current_difficulty') else v_est end;
        else
          -- ข้อใหม่: ใช้เนื้อหาล่าสุดเป็นเวอร์ชัน 1
          v_ver := case when jsonb_typeof(v_it->'versions') = 'array' and jsonb_array_length(v_it->'versions') > 0
                        then (select value from jsonb_array_elements(v_it->'versions') order by (value->>'version')::int desc nulls last limit 1)
                        else jsonb_build_object('content', v_it->'content', 'answer', v_it->'answer', 'qa', v_it->'qa') end;
          v_versions := jsonb_build_array(jsonb_build_object('version', 1, 'content', v_ver->'content', 'answer', v_ver->'answer',
                                                             'qa', v_ver->'qa', 'change_note', 'นำเข้าจากไฟล์'));
          v_status := 'draft';
          v_curd := v_est;
        end if;

        v_maxver := 0;
        for v_ver in select value from jsonb_array_elements(v_versions) loop
          perform public.bank_validate_content(v_type, v_ver->'content', v_ver->'answer');
          if coalesce((v_ver->>'version')::int, 0) < 1 then raise exception 'เลขเวอร์ชันไม่ถูกต้อง'; end if;
          v_maxver := greatest(v_maxver, (v_ver->>'version')::int);
        end loop;
        v_curver := case when v_restore then coalesce((v_it->>'current_version')::int, v_maxver) else 1 end;
        if not exists (select 1 from jsonb_array_elements(v_versions) x where (x.value->>'version')::int = v_curver) then
          raise exception 'ไม่มีเนื้อหาของเวอร์ชันปัจจุบัน (%)', v_curver;
        end if;

        insert into public.items(item_code, owner_id, subject_id, indicator_id, item_type, cognitive_level, est_difficulty,
                                 current_difficulty, status, current_version, no_shuffle, is_sample, tags, subtopic, created_at)
        values (v_code, v_owner, v_ind.subject_id, v_ind.id, v_type, v_cog, v_est, v_curd, v_status, v_curver,
                coalesce((v_it->>'no_shuffle')::boolean, false),
                v_restore and coalesce((v_it->>'is_sample')::boolean, false),
                coalesce((select array_agg(t) from jsonb_array_elements_text(coalesce(v_it->'tags', '[]'::jsonb)) t), '{}'),
                nullif(btrim(v_it->>'subtopic'), ''),
                case when v_restore then coalesce((v_it->>'created_at')::timestamptz, now()) else now() end)
        returning id, item_code into v_id, v_code;

        insert into public.item_versions(item_id, version, content, answer, qa, change_note, created_by, created_at)
        select v_id, (x.value->>'version')::int, x.value->'content', x.value->'answer',
               nullif(x.value->'qa', 'null'::jsonb), x.value->>'change_note', v_owner,
               coalesce((x.value->>'created_at')::timestamptz, now())
        from jsonb_array_elements(v_versions) x;

        if v_restore then
          insert into public.item_stat_rounds(item_id, version, grade_id, n, n_correct, r, option_counts, recorded_at)
          select v_id, (s.value->>'version')::int, s.value->>'grade_id', (s.value->>'n')::int, (s.value->>'n_correct')::int,
                 (s.value->>'r')::numeric, coalesce(s.value->'option_counts', '{}'::jsonb),
                 coalesce((s.value->>'recorded_at')::timestamptz, now())
          from jsonb_array_elements(coalesce(v_it->'stat_rounds', '[]'::jsonb)) s;
          -- คืนประวัติเดิมแทนเหตุการณ์ "สร้าง" ที่เพิ่งเกิดจากการนำเข้า
          if jsonb_array_length(coalesce(v_it->'events', '[]'::jsonb)) > 0 then
            delete from public.item_events where item_id = v_id;
            insert into public.item_events(item_id, event_type, payload, actor, at)
            select v_id, e.value->>'type', coalesce(e.value->'payload', '{}'::jsonb), v_owner,
                   coalesce((e.value->>'at')::timestamptz, now())
            from jsonb_array_elements(v_it->'events') e;
          end if;
        end if;
        insert into public.item_events(item_id, event_type, payload)
        values (v_id, 'imported', jsonb_build_object('mode', case when v_restore then 'restore' else 'new' end));
        v_inserted := v_inserted + 1;
      exception when others then
        v_errors := v_errors || jsonb_build_object('index', v_idx, 'item_code', v_code, 'message', sqlerrm);
      end;
    end loop;

    -- เลื่อนตัวนับรหัสข้อให้เกินรหัสที่กู้คืนมา
    select case when is_called then last_value + 1 else last_value end into v_next from public.item_code_seq;
    select coalesce(max(substring(item_code from '([0-9]+)$')::bigint), 0) into v_max from public.items;
    if v_max >= v_next then perform setval('public.item_code_seq', v_max, true); end if;

    if p_dry_run then raise exception using errcode = 'P0001', message = '__DRY_RUN__'; end if;
  exception when sqlstate 'P0001' then
    if sqlerrm <> '__DRY_RUN__' then raise; end if;
  end;

  return jsonb_build_object('dry_run', p_dry_run, 'inserted', v_inserted, 'skipped', v_skipped, 'errors', v_errors);
end $$;

-- ---------- สิทธิ์เรียกใช้ฟังก์ชัน: เฉพาะผู้ล็อกอิน (ภายในตรวจบทบาท owner/admin อีกชั้น) ----------
revoke execute on function public.bank_save_item(jsonb, text, text) from public, anon;
revoke execute on function public.bank_set_status(uuid, text, text) from public, anon;
revoke execute on function public.bank_delete_item(uuid) from public, anon;
revoke execute on function public.bank_export(text, boolean) from public, anon;
revoke execute on function public.bank_import(jsonb, boolean) from public, anon;
grant execute on function public.bank_save_item(jsonb, text, text) to authenticated;
grant execute on function public.bank_set_status(uuid, text, text) to authenticated;
grant execute on function public.bank_delete_item(uuid) to authenticated;
grant execute on function public.bank_export(text, boolean) to authenticated;
grant execute on function public.bank_import(jsonb, boolean) to authenticated;

commit;
