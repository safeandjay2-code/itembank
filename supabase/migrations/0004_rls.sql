-- =====================================================================
-- 0004_rls.sql — สิทธิ์การเข้าถึง (Row Level Security)
--   * ตารางอ้างอิง/ตั้งค่า: ผู้ล็อกอินอ่านได้, แก้ได้เฉพาะ owner/admin
--   * คลังข้อสอบ: เฉพาะ owner/admin (คลัง = ทรัพย์สินของเจ้าของระบบ SPEC §12)
--   * ชุดข้อสอบและข้อมูลลูก: เฉพาะเจ้าของชุด (หรือ owner/admin)
--   * ผู้ไม่ล็อกอิน (anon): ไม่เห็นอะไรเลย
-- =====================================================================
begin;
select public.app_begin_migration('0004', 'row level security policies');

-- ---------- ตารางอ้างอิง ----------
do $$
declare t text;
begin
  foreach t in array array['subjects','grades','strands','standards','indicators',
                           'difficulty_levels','cognitive_levels','item_types',
                           'app_settings','answer_sheet_templates']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)',
                   t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated
                    using (public.app_is_bank_admin()) with check (public.app_is_bank_admin())',
                   t || '_admin_write', t);
  end loop;
end $$;

alter table public.app_migrations enable row level security;
create policy app_migrations_read on public.app_migrations for select to authenticated using (true);

-- ---------- โปรไฟล์ ----------
alter table public.profiles enable row level security;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.app_is_bank_admin());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() or public.app_current_role() = 'owner')
  with check (id = auth.uid() or public.app_current_role() = 'owner');

-- ---------- คลังข้อสอบ ----------
do $$
declare t text;
begin
  foreach t in array array['items','item_versions','item_stat_rounds','item_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated
                    using (public.app_is_bank_admin()) with check (public.app_is_bank_admin())',
                   t || '_bank_admin', t);
  end loop;
end $$;

-- ---------- ชุดข้อสอบ ----------
alter table public.exams enable row level security;
create policy exams_owner on public.exams for all to authenticated
  using (owner_id = auth.uid() or public.app_is_bank_admin())
  with check (owner_id = auth.uid() or public.app_is_bank_admin());

create or replace function public.app_owns_exam(p_exam uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.exams e
                 where e.id = p_exam
                   and (e.owner_id = auth.uid() or public.app_is_bank_admin()))
$$;

do $$
declare t text;
begin
  foreach t in array array['exam_items','exam_set_items','exam_seats','responses']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated
                    using (public.app_owns_exam(exam_id)) with check (public.app_owns_exam(exam_id))',
                   t || '_exam_owner', t);
  end loop;
end $$;

commit;
