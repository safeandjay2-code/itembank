import { describe, it, expect } from 'vitest';
import { prepareImport, importTemplate } from '../../src/modules/bank/backup';
import { MemoryRepo } from '../../src/data/memoryRepo';

describe('เตรียมไฟล์นำเข้า', () => {
  it('ตรวจคุณภาพให้เวอร์ชันที่ยังไม่มีผลตรวจ', () => {
    const p = prepareImport(JSON.stringify(importTemplate()));
    expect(p.itemCount).toBe(1);
    expect(p.qaAdded).toBe(1);
    expect(p.qaFailed).toBe(0);
    expect((p.doc.items[0] as any).qa.passed).toBe(true);
  });
  it('ไฟล์ผิดรูปแบบ', () => {
    expect(() => prepareImport('{')).toThrow(/JSON/);
    expect(() => prepareImport('{"format":"x"}')).toThrow(/รูปแบบไฟล์/);
  });
});

describe('โหมดสาธิต: สำรองแล้วกู้คืนได้ครบ', () => {
  it('roundtrip', async () => {
    const a = new MemoryRepo(1);
    const doc = await a.exportBank('MATH', true);
    expect(doc.item_count).toBe(132);
    const b = new MemoryRepo(0);
    const r = await b.importBank(doc, false);
    expect(r.inserted).toBe(132);
    expect(r.errors).toEqual([]);
    const again = await b.importBank(doc, false);
    expect(again.skipped).toHaveLength(132);
    const cov = await b.getCoverage('MATH');
    expect(cov.reduce((s, c) => s + c.ready, 0)).toBe(132);
  });
});
