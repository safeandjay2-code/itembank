-- =====================================================================
-- 0008_scan.sql — เฟส 5 ตรวจด้วยกล้อง (SPEC §8)
--   * เครื่องอ่านกระดาษคำตอบทำงานในเบราว์เซอร์ ภาพไม่ถูกส่งมา — ฐานข้อมูลรับเฉพาะ "คำตอบที่อ่านได้" รายเลขที่
--   * คะแนนคำนวณที่ฐานข้อมูลเสมอ (ทริกเกอร์) จากเฉลยของชุดที่ใช้ตรวจ — ไม่เชื่อคะแนนจากหน้าเว็บ
--   * กฎ §8.3: ฝน 1 ช่อง = ตรวจตามเฉลย · ฝนหลายช่อง ("multi") / ไม่ฝน (null) = 0
--   * remark ใน responses.flags: ambiguous (ข้อที่อ่านกำกวม) และ wrong_set (สงสัยแจกผิดชุด — ฐานข้อมูลตรวจเอง)
--   * สแกนเลขที่ซ้ำ: ไม่เขียนทับเงียบ ๆ — คืนสถานะ exists ให้ครูเลือกแทนที่หรือข้าม
--   * ชุดที่เริ่มตรวจแล้วเปลี่ยนสถานะ draft → open
-- =====================================================================
begin;
select public.app_begin_migration('0008', 'scan: save/review/delete responses, server-side scoring, remarks, wrong-set detection');

insert into public.app_settings(key, value, description_th) values
  ('scan.fill_threshold', '0.34'::jsonb, 'ตรวจด้วยกล้อง: ความเข้มของวง (หักพื้นหลังแล้ว) ตั้งแต่ค่านี้ถือว่าฝน'),
  ('scan.blank_threshold', '0.1'::jsonb, 'ตรวจด้วยกล้อง: ต่ำกว่าค่านี้ถือว่าว่าง ระหว่างนี้กับเกณฑ์ฝน = กำกวม (ขึ้น remark)'),
  ('scan.multi_gap', '0.45'::jsonb, 'ตรวจด้วยกล้อง: ฝน 2 วงแต่วงเข้มสุดเข้มกว่าวงถัดไปเกินค่านี้ = น่าจะลบไม่สะอาด (remark) แทนฝนหลายช่อง'),
  ('scan.wrong_set_min_gain_ratio', '0.25'::jsonb, 'สงสัยแจกผิดชุด: คะแนนด้วยเฉลยชุดอื่นสูงกว่าชุดตัวเองอย่างน้อยสัดส่วนนี้ของจำนวนข้อ'),
  ('scan.wrong_set_min_alt_ratio', '0.6'::jsonb, 'สงสัยแจกผิดชุด: คะแนนด้วยเฉลยชุดอื่นต้องได้อย่างน้อยสัดส่วนนี้ของจำนวนข้อ'),
  ('scan.wrong_set_min_items', '10'::jsonb, 'ตรวจแจกผิดชุดเฉพาะชุดข้อสอบที่มีจำนวนข้อตั้งแต่ค่านี้')
on conflict (key) do nothing;

-- เฉลยของชุด (ตำแหน่ง 1..n → ตัวเลือก 1–4 ตามลำดับที่สลับแล้วของชุดนั้น)
create or replace function public.scan_keys(p_exam uuid, p_set int)
returns int[] language sql stable security definer set search_path = public as $$
  select array_agg(array_position(s.option_order, (v.answer->>'choice')::smallint)::int order by s.position)
  from exam_set_items s
  join exam_items x on x.exam_id = s.exam_id and x.item_id = s.item_id
  join item_versions v on v.item_id = s.item_id and v.version = x.item_version
  where s.exam_id = p_exam and s.set_no = p_set
$$;

create or replace function public.scan_score(p_answers jsonb, p_keys int[])
returns int language sql immutable as $$
  select count(*)::int from jsonb_array_elements(p_answers) with ordinality a(v, i)
  where jsonb_typeof(a.v) = 'number' and (a.v)::int = p_keys[a.i]
$$;

-- สงสัยแจกผิดชุด: คะแนนต่ำผิดปกติ แต่ตรวจด้วยเฉลยชุดอื่นได้สูง (กฎเดียวกับ web/src/modules/scan/grade.ts detectWrongSet)
create or replace function public.scan_wrong_set(p_exam uuid, p_answers jsonb, p_own_set int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  n int := jsonb_array_length(p_answers);
  v_own int; v_alt int; v_best jsonb := null; v_best_alt int := -1; s int; v_sets int;
begin
  if n < public.app_setting_num('scan.wrong_set_min_items', 10) then return null; end if;
  select set_count into v_sets from exams where id = p_exam;
  v_own := public.scan_score(p_answers, public.scan_keys(p_exam, p_own_set));
  for s in 1..coalesce(v_sets, 1) loop
    continue when s = p_own_set;
    v_alt := public.scan_score(p_answers, public.scan_keys(p_exam, s));
    if v_alt - v_own >= ceil(public.app_setting_num('scan.wrong_set_min_gain_ratio', 0.25) * n)
       and v_alt >= ceil(public.app_setting_num('scan.wrong_set_min_alt_ratio', 0.6) * n)
       and v_alt > v_best_alt then
      v_best_alt := v_alt;
      v_best := jsonb_build_object('type', 'wrong_set', 'suggested_set', s, 'score_alt', v_alt, 'resolved', false);
    end if;
  end loop;
  return v_best;
end $$;

-- ตรวจรูปแบบคำตอบ + คำนวณคะแนนทุกครั้งที่เขียน (ไม่ว่าจะมาทางไหน)
create or replace function public.tg_responses_score()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_n int; v_sets int; v_bad int;
begin
  select item_count, set_count into v_n, v_sets from exams where id = new.exam_id;
  if jsonb_typeof(new.answers) <> 'array' or jsonb_array_length(new.answers) <> v_n then
    raise exception 'คำตอบต้องมี % ข้อ ตามชุดข้อสอบ', v_n;
  end if;
  select count(*) into v_bad from jsonb_array_elements(new.answers) a(v)
  where not (a.v = 'null'::jsonb or a.v = '"multi"'::jsonb or a.v in ('1','2','3','4'));
  if v_bad > 0 then raise exception 'คำตอบแต่ละข้อต้องเป็น 1–4, ไม่ฝน (null) หรือ "multi"'; end if;
  if new.set_no not between 1 and v_sets then raise exception 'ชุดที่ % ไม่มีในชุดข้อสอบนี้', new.set_no; end if;
  if jsonb_typeof(new.flags) <> 'array' then raise exception 'flags ต้องเป็นอาร์เรย์'; end if;
  new.score := public.scan_score(new.answers, public.scan_keys(new.exam_id, new.set_no));
  return new;
end $$;
create trigger responses_score before insert or update on public.responses
  for each row execute function public.tg_responses_score();

create or replace function public.scan_row(r public.responses)
returns jsonb language sql stable as $$
  select jsonb_build_object('seat_no', r.seat_no, 'set_no', r.set_no, 'answers', r.answers, 'score', r.score,
    'flags', r.flags, 'source', r.source, 'scanned_at', r.scanned_at, 'updated_at', r.updated_at)
$$;

-- บันทึกผลตรวจ 1 แผ่น
--   p_ambiguous: ลำดับข้อที่เครื่องอ่านไม่แน่ใจ (remark)
--   p_replace: false = ถ้าเลขที่นี้ตรวจแล้วและคำตอบต่างเดิม ไม่เขียนทับ (คืน status = exists ให้ครูเลือก)
create or replace function public.scan_save_response(p_exam uuid, p_seat int, p_set int, p_answers jsonb,
  p_ambiguous int[] default '{}', p_source text default 'camera', p_replace boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e exams%rowtype; v_seat_set int; v_old responses%rowtype; v_flags jsonb := '[]'::jsonb; v_ws jsonb; v_amb int[]; r responses%rowtype;
begin
  if auth.uid() is null or not public.app_owns_exam(p_exam) then raise exception 'ไม่พบชุดข้อสอบ'; end if;
  select * into e from exams where id = p_exam;
  if e.status in ('closed', 'expired') then raise exception 'ชุดข้อสอบนี้ปิดแล้ว บันทึกคำตอบเพิ่มไม่ได้'; end if;
  select set_no into v_seat_set from exam_seats where exam_id = p_exam and seat_no = p_seat;
  if v_seat_set is null then raise exception 'ไม่มีเลขที่ % ในชุดข้อสอบนี้', p_seat; end if;
  if p_set <> v_seat_set then
    raise exception 'กระดาษคำตอบระบุชุดที่ % แต่เลขที่ % ได้ชุดที่ %', p_set, p_seat, v_seat_set;
  end if;
  if p_source not in ('camera', 'upload', 'manual') then raise exception 'แหล่งข้อมูลไม่ถูกต้อง'; end if;
  select array_agg(distinct x order by x) into v_amb from unnest(coalesce(p_ambiguous, '{}')) x;
  if exists (select 1 from unnest(coalesce(v_amb, '{}')) x where x not between 1 and e.item_count) then
    raise exception 'ลำดับข้อที่กำกวมไม่ถูกต้อง';
  end if;
  if coalesce(array_length(v_amb, 1), 0) > 0 then
    v_flags := v_flags || jsonb_build_array(jsonb_build_object('type', 'ambiguous', 'positions', to_jsonb(v_amb), 'resolved', false));
  end if;
  v_ws := public.scan_wrong_set(p_exam, p_answers, p_set);
  if v_ws is not null then v_flags := v_flags || jsonb_build_array(v_ws); end if;

  select * into v_old from responses where exam_id = p_exam and seat_no = p_seat;
  if found and not p_replace then
    if v_old.answers = p_answers and v_old.set_no = p_set then
      return jsonb_build_object('status', 'unchanged', 'response', public.scan_row(v_old));
    end if;
    return jsonb_build_object('status', 'exists', 'response', public.scan_row(v_old), 'new_score',
      public.scan_score(p_answers, public.scan_keys(p_exam, p_set)));
  end if;

  insert into responses(exam_id, seat_no, set_no, answers, flags, source)
  values (p_exam, p_seat, p_set, p_answers, v_flags, p_source)
  on conflict (exam_id, seat_no) do update set set_no = excluded.set_no, answers = excluded.answers, flags = excluded.flags,
    source = excluded.source, scanned_at = now()
  returning * into r;
  if e.status = 'draft' then update exams set status = 'open', opened_at = coalesce(opened_at, now()) where id = p_exam; end if;
  return jsonb_build_object('status', case when v_old.seat_no is null then 'saved' else 'replaced' end, 'response', public.scan_row(r));
end $$;

-- ครูยืนยัน/แก้คำตอบหลังดูกระดาษจริง (คิว remark) หรือยอมรับว่าแจกผิดชุด (ตรวจด้วยชุดอื่น)
--   remark ทั้งหมดของเลขที่นี้ถูกทำเครื่องหมายว่าแก้แล้ว (เก็บประวัติไว้ ไม่ลบ)
create or replace function public.scan_review_response(p_exam uuid, p_seat int, p_set int, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r responses%rowtype;
begin
  if auth.uid() is null or not public.app_owns_exam(p_exam) then raise exception 'ไม่พบชุดข้อสอบ'; end if;
  update responses set set_no = p_set, answers = p_answers,
    flags = (select coalesce(jsonb_agg(f || '{"resolved": true}'::jsonb), '[]'::jsonb) from jsonb_array_elements(flags) f)
  where exam_id = p_exam and seat_no = p_seat
  returning * into r;
  if not found then raise exception 'เลขที่ % ยังไม่ได้ตรวจ', p_seat; end if;
  return public.scan_row(r);
end $$;

-- ลบผลตรวจของเลขที่ (เพื่อสแกนใหม่)
create or replace function public.scan_delete_response(p_exam uuid, p_seat int)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is null or not public.app_owns_exam(p_exam) then raise exception 'ไม่พบชุดข้อสอบ'; end if;
  select status into v_status from exams where id = p_exam;
  if v_status in ('closed', 'expired') then raise exception 'ชุดข้อสอบนี้ปิดแล้ว'; end if;
  delete from responses where exam_id = p_exam and seat_no = p_seat;
end $$;

-- ผลตรวจทั้งหมดของชุด (เรียงตามเลขที่)
create or replace function public.scan_responses(p_exam uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.app_owns_exam(p_exam) then raise exception 'ไม่พบชุดข้อสอบ'; end if;
  return coalesce((select jsonb_agg(public.scan_row(r) order by r.seat_no) from responses r where r.exam_id = p_exam), '[]'::jsonb);
end $$;

revoke execute on function public.scan_keys(uuid, int) from public, anon, authenticated;
revoke execute on function public.scan_wrong_set(uuid, jsonb, int) from public, anon, authenticated;
revoke execute on function public.scan_save_response(uuid, int, int, jsonb, int[], text, boolean) from public, anon;
revoke execute on function public.scan_review_response(uuid, int, int, jsonb) from public, anon;
revoke execute on function public.scan_delete_response(uuid, int) from public, anon;
revoke execute on function public.scan_responses(uuid) from public, anon;
grant execute on function public.scan_save_response(uuid, int, int, jsonb, int[], text, boolean) to authenticated;
grant execute on function public.scan_review_response(uuid, int, int, jsonb) to authenticated;
grant execute on function public.scan_delete_response(uuid, int) to authenticated;
grant execute on function public.scan_responses(uuid) to authenticated;

commit;
