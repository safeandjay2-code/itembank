// สร้างไฟล์ seed SQL จากข้อมูลต้นฉบับ (JSON) — แหล่งความจริงคือไฟล์ใน data/
// ใช้: node scripts/build-seed.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const q = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const j = (v) => `${q(JSON.stringify(v))}::jsonb`;

const cur = JSON.parse(readFileSync(join(root, 'data/curriculum/math_2560_terminal_p4_p6.json'), 'utf8'));
const settings = JSON.parse(readFileSync(join(root, 'data/settings.default.json'), 'utf8'));
const levels = JSON.parse(readFileSync(join(root, 'data/levels.json'), 'utf8'));

const out = [];
out.push('-- สร้างอัตโนมัติจาก data/*.json ด้วย scripts/build-seed.mjs — ห้ามแก้ไฟล์นี้ด้วยมือ');
out.push('begin;');
out.push(`select public.app_begin_migration('S001', 'seed: reference data + math 2560 terminal indicators P4-P6');`);

// ระดับความยาก / ระดับการคิด / ประเภทข้อ
for (const d of levels.difficulty) {
  out.push(`insert into public.difficulty_levels(id,key,name_th,p_lower,p_upper) values (${d.id},${q(d.key)},${q(d.name_th)},${d.p_lower},${d.p_upper});`);
}
for (const c of levels.cognitive) {
  out.push(`insert into public.cognitive_levels(id,key,name_th) values (${c.id},${q(c.key)},${q(c.name_th)});`);
}
for (const t of levels.item_types) {
  out.push(`insert into public.item_types(key,name_th,response_kind,option_count,active) values (${q(t.key)},${q(t.name_th)},${q(t.response_kind)},${t.option_count ?? 'null'},${t.active});`);
}

// ตั้งค่า
for (const s of settings) {
  out.push(`insert into public.app_settings(key,value,description_th) values (${q(s.key)},${j(s.value)},${q(s.description_th)});`);
}

// แบบกระดาษคำตอบรุ่นแรก (รายละเอียดตำแหน่งกำหนดในเฟส 4)
out.push(`insert into public.answer_sheet_templates(version,name_th,spec) values (1,'A5 ปรนัย 4 ตัวเลือก รุ่นที่ 1','{"paper":"A5","per_a4":2,"choices":4,"corner_markers":true,"qr":true}'::jsonb);`);

// หลักสูตร
const s = cur.subject;
out.push(`insert into public.subjects(id,name_th,code_prefix,sort) values (${q(s.id)},${q(s.name_th)},'M',1);`);
for (const g of cur.grades) {
  out.push(`insert into public.grades(id,name_th,short_th,sort) values (${q(g.id)},${q(g.name_th)},${q(g.short_th)},${g.sort}) on conflict (id) do nothing;`);
}
for (const st of cur.strands) {
  out.push(`insert into public.strands(subject_id,no,name_th) values (${q(s.id)},${st.no},${q(st.name_th)});`);
}
for (const sd of cur.standards) {
  out.push(`insert into public.standards(subject_id,code,strand_no,text) values (${q(s.id)},${q(sd.code)},${sd.strand},${q(sd.text)});`);
}
const perGrade = {};
for (const ind of cur.indicators) {
  perGrade[ind.grade] = (perGrade[ind.grade] || 0) + 1;
  const sort = perGrade[ind.grade];
  const id = `${s.id}-${cur.curriculum_version}-${ind.grade}-${String(sort).padStart(2, '0')}`;
  out.push(`insert into public.indicators(id,subject_id,curriculum_version,grade_id,standard_code,code,text,kind,group_no,sort,assessment_note) values (${q(id)},${q(s.id)},${q(cur.curriculum_version)},${q(ind.grade)},${q(ind.standard)},${q(ind.code)},${q(ind.text)},'terminal',${ind.group},${sort},${q(ind.assessment_note ?? null)});`);
}
out.push('commit;');

mkdirSync(join(root, 'supabase/seed'), { recursive: true });
writeFileSync(join(root, 'supabase/seed/S001_reference_data.sql'), out.join('\n') + '\n');
console.log('wrote supabase/seed/S001_reference_data.sql', perGrade);
