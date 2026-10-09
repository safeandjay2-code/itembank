-- ข้อหุ่นสำหรับทดสอบระบบ (is_sample = true) — ลบทั้งหมดได้ด้วย select public.bank_remove_sample_items();
-- สร้าง 2 ข้อต่อ ตัวชี้วัด × ระดับความยาก (33 × 4 × 2 = 264 ข้อ) เป็นของผู้ใช้บทบาท owner
begin;
do $$
declare
  v_owner uuid := (select id from public.profiles where role = 'owner' order by created_at limit 1);
  v_ind   record;
  v_d     record;
  v_k     int;
  v_item  uuid;
  v_ans   int;
begin
  if v_owner is null then
    raise exception 'ยังไม่มีผู้ใช้บทบาท owner — ตั้ง owner ก่อนใส่ข้อหุ่น';
  end if;
  for v_ind in select * from public.indicators where kind = 'terminal' order by grade_id, sort loop
    for v_d in select * from public.difficulty_levels order by id loop
      for v_k in 1..2 loop
        v_ans := 1 + floor(random() * 4)::int;
        insert into public.items(owner_id, subject_id, indicator_id, cognitive_level,
                                 est_difficulty, current_difficulty, status, is_sample)
        values (v_owner, v_ind.subject_id, v_ind.id, 1 + (v_k % 4), v_d.id, v_d.id, 'reviewed', true)
        returning id into v_item;
        insert into public.item_versions(item_id, version, content, answer, created_by)
        values (v_item, 1,
          jsonb_build_object(
            'stem', format('ข้อทดสอบ %s ระดับ%s #%s', v_ind.code, v_d.name_th, lpad(v_k::text, 2, '0')),
            'options', jsonb_build_array('ตัวเลือก 1', 'ตัวเลือก 2', 'ตัวเลือก 3', 'ตัวเลือก 4'),
            'figure', null,
            'explanation', 'ข้อหุ่นสำหรับทดสอบระบบ',
            'distractor_rationale', jsonb_build_array(null, null, null, null)),
          jsonb_build_object('choice', v_ans),
          v_owner);
      end loop;
    end loop;
  end loop;
end $$;
commit;
