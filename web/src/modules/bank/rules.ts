// กฎของคลังข้อสอบที่ใช้ร่วมกันระหว่างหน้าจอและโหมดสาธิต (ฐานข้อมูลบังคับกฎชุดเดียวกันใน migration 0005)
//   §5.4 แก้คำผิด/รูปแบบ → เวอร์ชันเดิม · แก้ตัวเลข ตัวเลือก เฉลย รูป → เวอร์ชันใหม่ สถิติเริ่มนับใหม่
//   §5.6 ต้องผ่านการตรวจอัตโนมัติก่อนเป็น "ตรวจแล้ว"
import type { ItemAnswer, ItemContent, ItemStatus } from '../../core/types';

/** ลายเซ็นตัวเลขในข้อความ — ถ้าตัวเลขเปลี่ยน ถือว่าแก้สาระสำคัญ (ตรงกับฟังก์ชัน bank_digits ในฐานข้อมูล) */
export function digitSignature(text: string | null | undefined): string {
  return (String(text ?? '').match(/\d+(?:[.,]\d+)*/g) ?? []).join('|');
}

/** แปลงเป็น JSON ที่เรียงคีย์ เพื่อเทียบค่ารูปได้ตรง */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
}

export interface EditClass {
  changed: boolean;
  /** แก้แบบ "เวอร์ชันเดิม" ได้หรือไม่ */
  minorAllowed: boolean;
  /** เหตุผลที่ต้องขึ้นเวอร์ชันใหม่ */
  majorReasons: string[];
  /** แนะนำให้ขึ้นเวอร์ชันใหม่ (เช่น ข้อความตัวเลือกเปลี่ยน แม้ตัวเลขไม่เปลี่ยน) */
  suggestMajor: boolean;
}

export function classifyEdit(oldC: ItemContent, oldA: ItemAnswer, newC: ItemContent, newA: ItemAnswer): EditClass {
  const reasons: string[] = [];
  if (oldA?.choice !== newA?.choice) reasons.push('เปลี่ยนเฉลย');
  const oo = oldC.options ?? [], no = newC.options ?? [];
  if (oo.length !== no.length) reasons.push('จำนวนตัวเลือกเปลี่ยน');
  else oo.forEach((o, i) => { if (digitSignature(o) !== digitSignature(no[i])) reasons.push(`ตัวเลขในตัวเลือก ${i + 1} เปลี่ยน`); });
  if (digitSignature(oldC.stem) !== digitSignature(newC.stem)) reasons.push('ตัวเลขในโจทย์เปลี่ยน');
  if (stableJson(oldC.figure ?? null) !== stableJson(newC.figure ?? null)) reasons.push('รูปเปลี่ยน');
  const optionTextChanged = oo.length === no.length && oo.some((o, i) => (o ?? '').trim() !== (no[i] ?? '').trim());
  const changed = stableJson({ c: oldC, a: oldA }) !== stableJson({ c: newC, a: newA });
  return { changed, minorAllowed: reasons.length === 0, majorReasons: reasons, suggestMajor: reasons.length > 0 || optionTextChanged };
}

/** สถานะหลังบันทึก */
export function statusAfterSave(prev: ItemStatus | null, mode: 'new' | 'minor' | 'major', qaPassed: boolean): ItemStatus {
  if (mode === 'new' || mode === 'major') return 'draft';
  if (!qaPassed && (prev === 'reviewed' || prev === 'active')) return 'needs_fix';
  return prev ?? 'draft';
}

/** เปลี่ยนสถานะได้หรือไม่ (null = ได้, ข้อความ = เหตุผลที่ไม่ได้) */
export function statusChangeBlocked(to: ItemStatus, qaPassed: boolean | null): string | null {
  if ((to === 'reviewed' || to === 'active') && qaPassed !== true)
    return 'ต้องผ่านการตรวจอัตโนมัติก่อน (เปิดแก้ไขแล้วบันทึกใหม่เพื่อตรวจ)';
  return null;
}

/** สถานะที่ถูกสุ่มเข้าชุดข้อสอบได้ (SPEC §6.2) */
export const ASSEMBLABLE: ItemStatus[] = ['reviewed', 'active'];

export function emptyContent(): ItemContent {
  return { stem: '', options: ['', '', '', ''], figure: null, explanation: '', distractor_rationale: [null, null, null, null], check: null };
}
