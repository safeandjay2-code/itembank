-- =====================================================================
-- 0012_exam_link.sql — One Stop เฟส 3: สร้างชุดข้อสอบผูกห้อง + ประเภทการสอบ
-- อ้างอิง SPEC-OneStop.md §2 ข้อ 3, §4
--   * exam_create_linked : สร้างชุด + ผูกห้อง/ประเภทการสอบ/สอบซ่อม ในคำสั่งเดียว (ผิดข้อใด = ไม่สร้างอะไรเลย)
--   * กติกาความเข้ากันของชุดกับห้อง (ใช้ทั้งตอนสร้างและตอนเปลี่ยนห้องทีหลังด้วย gb_exam_link):
--       - ชั้นของชุดต้องตรงกับชั้นของห้อง
--       - ชุดเก็บคะแนน/ปลายภาค (ไม่ใช่สอบซ่อม) ต้องมีเลขที่ครบทุกคนในห้อง (จำนวนนักเรียนของชุด ≥ ของห้อง)
--         สอบซ่อม/สอบซ้ำ ไม่บังคับ (เลขที่ยังเป็นเลขที่เดิมของห้อง)
-- ผลตรวจ → คะแนนสะสม ใช้ trigger เดิมจาก 0011 (responses → gb_attempts) ไม่ต้องแก้
-- =====================================================================
begin;
select public.app_begin_migration('0012', 'exam link: create exam with classroom/purpose/retake in one call, exam-classroom fit rules');

-- ---------- ชุดต้องเข้ากับห้อง ----------
create or replace function public.tg_exams_classroom_fit()
returns trigger language plpgsql security definer set search_path = public as $$
declare c gb_classrooms%rowtype;
begin
  if new.classroom_id is null then return new; end if;
  -- ลบชุดแรกของกลุ่มสอบซ่อม → ฐานข้อมูลตั้ง retake_of ของสอบซ่อมเป็นว่างเอง (on delete set null)
  --   สอบซ่อมนั้นกลายเป็นชุดปกติของห้อง ไม่ต้องตรวจจำนวนเลขที่ซ้ำ (เลขที่ที่ไม่มี = ขาดสอบตามตั้งค่าห้อง)
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and new.retake_of is null
     and (new.classroom_id, new.purpose, new.grade_id, new.student_count) is not distinct from
         (old.classroom_id, old.purpose, old.grade_id, old.student_count) then
    return new;
  end if;
  select * into c from gb_classrooms where id = new.classroom_id;
  if not found then return new; end if;
  if new.grade_id <> c.grade_id then
    raise exception 'ชั้นของชุดข้อสอบไม่ตรงกับชั้นของห้อง %', c.name;
  end if;
  if new.purpose in ('collect', 'final') and new.retake_of is null and new.student_count < c.student_count then
    raise exception 'ห้อง % มีนักเรียน % คน แต่ชุดข้อสอบมีเลขที่ถึง % — ตั้งจำนวนนักเรียนของชุดให้ครบทั้งห้อง',
      c.name, c.student_count, new.student_count;
  end if;
  return new;
end $$;
create trigger exams_classroom_fit before insert or update of classroom_id, purpose, retake_of, grade_id, student_count on public.exams
  for each row execute function public.tg_exams_classroom_fit();

-- ---------- สร้างชุด + ผูกห้อง ----------
-- p = ข้อมูลเดียวกับ exam_create + {classroom_id?, purpose?, retake_of?}
--   ไม่ส่ง purpose หรือส่ง practice โดยไม่มีห้อง = ชุดฝึกแบบเดิม (เหมือน exam_create ทุกอย่าง)
create or replace function public.exam_create_linked(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_exam uuid;
  v_purpose text := coalesce(nullif(p->>'purpose', ''), 'practice');
  v_classroom uuid;
  v_retake uuid;
begin
  begin
    v_classroom := nullif(p->>'classroom_id', '')::uuid;
    v_retake := nullif(p->>'retake_of', '')::uuid;
  exception when others then raise exception 'ข้อมูลห้องเรียน/ชุดเดิมไม่ถูกต้อง'; end;
  v_exam := public.exam_create(p - 'classroom_id' - 'purpose' - 'retake_of');
  if v_classroom is not null or v_purpose <> 'practice' or v_retake is not null then
    perform public.gb_exam_link(v_exam, v_classroom, v_purpose, v_retake);
  end if;
  return v_exam;
end $$;

revoke execute on function public.exam_create_linked(jsonb) from public, anon;
grant execute on function public.exam_create_linked(jsonb) to authenticated;
revoke execute on function public.tg_exams_classroom_fit() from public, anon, authenticated;

commit;
