// เตรียมไฟล์นำเข้า: ตรวจรูปแบบ และตรวจคุณภาพอัตโนมัติให้ทุกเวอร์ชันที่ยังไม่มีผลตรวจ
// (ข้อที่ร่างด้วย AI จึงเข้าคลังพร้อมผลตรวจ ครูเห็นทันทีว่าข้อไหนต้องแก้)
import type { BankExport, ItemAnswer, ItemContent } from '../../core/types';
import { runQa } from './qa';
import { emptyContent } from './rules';

export interface PreparedImport { doc: BankExport; itemCount: number; qaAdded: number; qaFailed: number }

export function prepareImport(text: string, opts: { requireCheck?: boolean } = {}): PreparedImport {
  let doc: any;
  try { doc = JSON.parse(text); } catch { throw new Error('ไฟล์ไม่ใช่ JSON ที่ถูกต้อง'); }
  if (doc?.format !== 'itembank.bank.v1') throw new Error('รูปแบบไฟล์ไม่ถูกต้อง (ต้องเป็นไฟล์สำรองคลัง itembank.bank.v1)');
  if (!Array.isArray(doc.items)) throw new Error('ไฟล์ไม่มีรายการข้อสอบ (items)');
  let qaAdded = 0, qaFailed = 0;
  const check = (v: any) => {
    if (!v || typeof v !== 'object' || v.qa || !v.content || !v.answer) return;
    const content: ItemContent = { ...emptyContent(), ...v.content };
    if (!Array.isArray(content.distractor_rationale)) content.distractor_rationale = [null, null, null, null];
    v.qa = runQa(content, v.answer as ItemAnswer, { requireCheck: opts.requireCheck });
    qaAdded++;
    if (!v.qa.passed) qaFailed++;
  };
  for (const it of doc.items) {
    if (!it || typeof it !== 'object') continue;
    if (Array.isArray(it.versions) && it.versions.length) it.versions.forEach(check);
    else check(it);
  }
  return { doc, itemCount: doc.items.length, qaAdded, qaFailed };
}

/** แม่แบบไฟล์นำเข้าข้อใหม่ (ไม่มีรหัสข้อ = ข้อใหม่ เข้าคลังเป็นร่าง) */
export function importTemplate(): BankExport {
  return {
    format: 'itembank.bank.v1', exported_at: new Date().toISOString(), subject_id: 'MATH', item_count: 1,
    items: [{
      indicator_code: 'ค 1.1 ป.4/2', cognitive_level: 'apply', est_difficulty: 'easy', subtopic: 'การบวก', tags: [],
      content: {
        stem: 'ผลบวกของ 1,250 และ 3,475 เท่ากับเท่าใด', options: ['4,725', '4,625', '4,715', '5,725'], figure: null,
        explanation: '1,250 + 3,475 = 4,725',
        distractor_rationale: [null, 'ลืมทด', 'บวกหลักหน่วยผิด', 'ทดเกินในหลักพัน'], check: '1250 + 3475',
      },
      answer: { choice: 1 },
    }],
  };
}

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const today = () => new Date().toISOString().slice(0, 10);
