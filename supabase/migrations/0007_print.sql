-- =====================================================================
-- 0007_print.sql — เฟส 4 เอกสารพิมพ์ (SPEC §7)
--   * exams.duration_min เวลาสอบสำหรับหัวกระดาษ (ค่าเริ่มต้น = จำนวนข้อ × print.minutes_per_item) แก้ได้ด้วย exam_update_meta
--   * แบบกระดาษคำตอบรุ่น 1: ตำแหน่งมุมดำ QR วงกลม (มม.) จาก data/answer_sheet_template_v1.json — ความจุ 45 ข้อ
--   * ชุดข้อสอบต้องมีจำนวนข้อไม่เกินความจุของแบบกระดาษคำตอบ
--   * exam_get คืนเวลาสอบและรุ่นแบบกระดาษคำตอบเพิ่ม
-- =====================================================================
begin;
select public.app_begin_migration('0007', 'print: exam duration/meta, answer sheet template v1 geometry, capacity guard');

insert into public.app_settings(key, value, description_th) values
  ('assembly.max_items', '45'::jsonb, 'จำนวนข้อสูงสุดต่อชุดข้อสอบ (ต้องไม่เกินความจุกระดาษคำตอบ)'),
  ('print.minutes_per_item', '2'::jsonb, 'เวลาสอบเริ่มต้นต่อข้อ (นาที) ใช้ตั้งเวลาบนหัวกระดาษ แก้ได้รายชุด')
on conflict (key) do nothing;

alter table public.exams add column duration_min int check (duration_min between 1 and 300);

-- แบบกระดาษคำตอบรุ่น 1 (ยังไม่เคยพิมพ์ใช้จริง จึงเติมรายละเอียดตำแหน่งในรุ่นเดิมได้)
insert into public.answer_sheet_templates(version, name_th, spec) values (1, 'A5 ปรนัย 4 ตัวเลือก รุ่นที่ 1', '{"version":1,"name_th":"A5 ปรนัย 4 ตัวเลือก รุ่นที่ 1","units":"mm","paper":{"size":"A5","width":148,"height":210,"per_a4":2,"a4_orientation":"landscape"},"corner_marks":{"size":7,"top_left":[[8,8],[133,8],[8,195],[133,195]],"order":["tl","tr","bl","br"]},"qr":{"x":107,"y":19,"size":26,"ecc":"M","payload":"IB1|<exam_id>|<set_no>|<seat_no>|<template_version>","payload_note":"ไม่มีเฉลยหรือรหัสข้อสอบ (SPEC §7.2)"},"header":{"x":18,"y":18,"width":86,"height":32},"bubbles":{"capacity":45,"choices":4,"columns":3,"rows":15,"column_x":[18,59,100],"number_offset_x":4,"first_bubble_offset_x":11,"bubble_pitch_x":6.6,"first_row_y":66,"row_pitch_y":6.6,"radius":2.3,"label_y":59,"order":"column-major: ข้อ 1–15 คอลัมน์ 1, 16–30 คอลัมน์ 2, 31–45 คอลัมน์ 3"},"reserved_numeric":{"x":15,"y":166,"width":118,"height":16,"note":"เว้นไว้สำหรับช่องระบายตัวเลข (ประเภท numeric) ในรุ่นถัดไป"},"scorer":{"x":15,"y":184,"width":118,"height":8}}'::jsonb)
on conflict (version) do update set spec = excluded.spec, name_th = excluded.name_th;

-- เวลาเริ่มต้น + จำนวนข้อไม่เกินความจุกระดาษคำตอบ
create or replace function public.tg_exams_print_defaults()
returns trigger language plpgsql as $$
declare v_cap int;
begin
  if new.duration_min is null and tg_op = 'INSERT' then
    new.duration_min := least(300, greatest(1, ceil(new.item_count * public.app_setting_num('print.minutes_per_item', 2))::int));
  end if;
  select (spec->'bubbles'->>'capacity')::int into v_cap from public.answer_sheet_templates where version = new.template_version;
  if v_cap is not null and new.item_count > v_cap then
    raise exception 'ชุดข้อสอบมี % ข้อ เกินความจุกระดาษคำตอบ (% ข้อ)', new.item_count, v_cap;
  end if;
  return new;
end $$;
create trigger exams_print_defaults before insert or update of item_count, template_version, duration_min on public.exams
  for each row execute function public.tg_exams_print_defaults();

-- แก้ชื่อแบบทดสอบและเวลาสอบ (หัวกระดาษ)
create or replace function public.exam_update_meta(p_exam uuid, p_title text, p_duration_min int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.app_owns_exam(p_exam) then raise exception 'ไม่พบชุดข้อสอบ'; end if;
  if btrim(coalesce(p_title, '')) = '' or length(btrim(p_title)) > 200 then raise exception 'ชื่อแบบทดสอบต้องมี 1–200 ตัวอักษร'; end if;
  if p_duration_min is null or p_duration_min not between 1 and 300 then raise exception 'เวลาสอบต้องอยู่ระหว่าง 1–300 นาที'; end if;
  update exams set title = btrim(p_title), duration_min = p_duration_min where id = p_exam;
  if not found then raise exception 'ไม่พบชุดข้อสอบ'; end if;
end $$;

-- ---------- รายละเอียดชุดข้อสอบ ----------
create or replace function public.exam_get(p_exam uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is not null and not public.app_owns_exam(p_exam) then raise exception 'ไม่พบชุดข้อสอบ'; end if;
  select jsonb_build_object(
    'id', e.id, 'title', e.title, 'grade_id', e.grade_id, 'item_count', e.item_count, 'set_count', e.set_count,
    'student_count', e.student_count, 'status', e.status, 'duration_min', e.duration_min, 'template_version', e.template_version, 'created_at', e.created_at, 'build_params', e.build_params,
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


revoke execute on function public.exam_update_meta(uuid, text, int) from public, anon;
grant execute on function public.exam_update_meta(uuid, text, int) to authenticated;

commit;
