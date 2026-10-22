// ทดสอบ One Stop เฟส 6: ทดสอบรวมทั้งเส้นทางในเส้นเดียว (โหมดสาธิต)
//   ตั้งห้อง → ชุดเก็บคะแนน → ตรวจ → เพิ่มช่อง/ตั้งคะแนนเต็ม → สอบซ่อม → ปลายภาค → สมุดคะแนน → ปรับให้ผ่าน
//   → ส่งออกชีท (ตรวจไฟล์) → ปิดเทอม → สรุป · ชุดฝึกของครูไม่ถูกแตะ
// ค่าที่คำนวณมือ (เต็ม IND1 10 · IND2 10 · ปลายภาค 30 · นับสอบซ่อมครั้งสูงสุด · ขาดสอบ = 0 · ปัดครึ่งขึ้น)
//   ชุดเก็บคะแนน (ถูก IND1/4, IND2/2): 1: 4,2 · 2: 2,1 · 3: 1,0 · 4: 0,0 · 5: 3,2 · 6: 4,2 · 7: ขาด
//   สอบซ่อม: เลขที่ 3 ถูกหมด (4,2) → เลขที่ 3 = 10, 10
//   ปลายภาค (6 ข้อ): 1: 6 → 30 · 2: 3 → 15 · 5: 5 → 25 · 6: 6 → 30 · 3, 4, 7 ขาด → 0
//   ปรับเลขที่ 4 IND1 ให้ผ่าน = 5
//   IND1 = 10 5 10 5 8 10 0 · IND2 = 10 5 10 0 10 10 0 · ปลายภาค = 30 15 0 0 25 30 0
//   รวม = 50 25 20 5 43 50 0 → เฉลี่ย 193 ÷ 7 = 27.57
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { IND1, IND2, TMP, login, setRow } from './scanTools';
import { colVals, createExam, fillScans, row, setupBook } from './bookTools';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await login(page);
});

async function readSheets(path: string) {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const wb = await zip.file('xl/workbook.xml')!.async('string');
  const read = async (n: number) => {
    const xml = await zip.file(`xl/worksheets/sheet${n}.xml`)!.async('string');
    const cells: Record<string, string | number> = {};
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>(.*?)<\/c>)/g)) {
      const body = m[2] ?? '';
      const t = /<t[^>]*>(.*?)<\/t>/.exec(body), f = /<f>(.*?)<\/f>/.exec(body), v = /<v>(.*?)<\/v>/.exec(body);
      if (f) cells[m[1]] = `=${f[1]}`; else if (t) cells[m[1]] = t[1]; else if (v) cells[m[1]] = Number(v[1]);
    }
    return cells;
  };
  return { names: [...wb.matchAll(/<sheet name="([^"]+)"/g)].map((x) => x[1]), main: await read(1), notes: await read(2) };
}

/** ชุดปลายภาคจากหน้าห้อง: IND1 4 ข้อ + IND2 2 ข้อ · นักเรียนครบห้อง */
async function createFinal(page: Page): Promise<string> {
  await page.goto('/#/exams/new?classroom=class-1');
  await page.getByRole('group', { name: 'ประเภทการสอบ' }).getByRole('button', { name: 'ปลายภาค' }).click();
  await expect(page.getByLabel('ชื่อแบบทดสอบ')).toHaveValue('แบบทดสอบปลายภาค คณิตศาสตร์ ป.4/1');
  await page.getByLabel('จำนวนข้อ', { exact: true }).fill('6');
  await page.getByLabel('จำนวนชุด (กันลอก)').fill('3');
  await setRow(page, 1, IND1, 'ง่าย', 2);
  await page.getByRole('button', { name: '+ เพิ่มแถว' }).click();
  await setRow(page, 2, IND1, 'ปานกลาง', 2);
  await page.getByRole('button', { name: '+ เพิ่มแถว' }).click();
  await setRow(page, 3, IND2, 'ยาก', 2);
  await expect(page.getByLabel('จำนวนนักเรียน (เลขที่ 1–N)')).toHaveValue('7');
  await page.getByRole('button', { name: 'สร้างข้อสอบ' }).click();
  await expect(page.getByTestId('exam-link-label')).toHaveText('ปลายภาค · ป.4/1');
  return /#\/exams\/([^?]+)/.exec(page.url())![1];
}

const allVals = async (page: Page, k: number) => (await colVals(page, k)).map((s) => s.replace('*', '').trim());

test('ทั้งเส้นทาง: ตั้งห้อง → สอบ → สอบซ่อม → ปลายภาค → ปรับให้ผ่าน → ส่งออกชีท → ปิดเทอม', async ({ page }, info) => {
  // 1) ห้อง + ชุดเก็บคะแนน + ผลตรวจ + ช่องตัวชี้วัด (เต็ม 10)
  await setupBook(page);
  expect(await allVals(page, 0)).toEqual(['10', '5', '3', '0', '8', '10', '0']);

  // 2) ชุดฝึกของครู (ไม่ผูกห้อง) ตรวจไป 1 คน — ต้องไม่ถูกแตะตอนปิดเทอม
  await page.goto('/#/exams/new');
  await page.getByRole('button', { name: 'ป.4', exact: true }).click();
  await page.getByLabel('จำนวนข้อ', { exact: true }).fill('6');
  await page.getByLabel('จำนวนชุด (กันลอก)').fill('3');
  await setRow(page, 1, IND1, 'ง่าย', 2);
  await page.getByRole('button', { name: '+ เพิ่มแถว' }).click();
  await setRow(page, 2, IND1, 'ปานกลาง', 2);
  await page.getByRole('button', { name: '+ เพิ่มแถว' }).click();
  await setRow(page, 3, IND2, 'ยาก', 2);
  await page.getByLabel('จำนวนนักเรียน (เลขที่ 1–N)').fill('5');
  await page.getByLabel('ชื่อแบบทดสอบ').fill('ฝึกก่อนสอบ');
  await page.getByRole('button', { name: 'สร้างข้อสอบ' }).click();
  await expect(page.getByTestId('exam-link-label')).toHaveText('ฝึก/วินิจฉัย');
  const practice = /#\/exams\/([^?]+)/.exec(page.url())![1];
  await fillScans(page, practice, { 1: [4, 2] });

  // 3) สอบซ่อมเลขที่ 1–3 · เลขที่ 3 ถูกหมด
  const retake = await createExam(page, 3, 'แบบทดสอบ คณิตศาสตร์ ป.4/1');
  await expect(page.getByTestId('exam-link-label')).toContainText('สอบซ่อม');
  await fillScans(page, retake, { 3: [4, 2] });

  // 4) ปลายภาค
  const final = await createFinal(page);
  await fillScans(page, final, { 1: [4, 2], 2: [2, 1], 5: [3, 2], 6: [4, 2] });

  // 5) สมุดคะแนน
  await page.goto('/#/classes/class-1/book');
  await expect(page.getByTestId('book-title')).toContainText('สมุดคะแนน ป.4/1');
  expect(await allVals(page, 0)).toEqual(['10', '5', '10', '0', '8', '10', '0']);
  expect(await allVals(page, 1)).toEqual(['10', '5', '10', '0', '10', '10', '0']);
  expect(await allVals(page, 2)).toEqual(['30', '15', '0', '0', '25', '30', '0']);
  await expect(page.getByTestId('alert-unplanned')).toHaveCount(0);

  // 6) ปรับเลขที่ 4 IND1 ให้ผ่าน (0 → 5)
  await row(page, 4).locator('td.cell-td').first().getByRole('button').click();
  await page.getByTestId('cell-panel').getByTestId('adjust-pass').click();
  await expect(page.getByTestId('book-status')).toContainText('ให้ผ่าน');
  await page.keyboard.press('Escape');
  expect(await allVals(page, 0)).toEqual(['10', '5', '10', '5', '8', '10', '0']);
  await page.screenshot({ path: join(TMP, `journey-book-${info.project.name}.png`), fullPage: true });

  // 7) ส่งออกชีท + รายชื่อ
  await page.getByTestId('book-export').click();
  await expect(page.getByTestId('term-title')).toContainText('ส่งออกชีทและปิดเทอม: ป.4/1');
  await page.getByTestId('term-names').fill('ด.ช.หนึ่ง\nด.ญ.สอง\nด.ช.สาม\nด.ญ.สี่\nด.ช.ห้า\nด.ญ.หก\nด.ช.เจ็ด');
  await expect(page.getByTestId('term-names-info')).toContainText('จับคู่ได้ 7 จาก 7 คน');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('term-download').click()]);
  const file = join(TMP, `journey-${info.project.name}.xlsx`);
  await dl.saveAs(file);
  const { names, main, notes } = await readSheets(file);
  expect(names).toEqual(['ป.4-1', 'บันทึก']);
  const rows = [4, 5, 6, 7, 8, 9, 10];
  expect(rows.map((r) => main[`B${r}`])).toEqual(['ด.ช.หนึ่ง', 'ด.ญ.สอง', 'ด.ช.สาม', 'ด.ญ.สี่', 'ด.ช.ห้า', 'ด.ญ.หก', 'ด.ช.เจ็ด']);
  expect(rows.map((r) => main[`C${r}`])).toEqual([10, 5, 10, 5, 8, 10, 0]);
  expect(rows.map((r) => main[`D${r}`])).toEqual([10, 5, 10, 0, 10, 10, 0]);
  expect(rows.map((r) => main[`F${r}`])).toEqual([30, 15, 0, 0, 25, 30, 0]);
  expect([main.E4, main.G4, main.F3]).toEqual(['=SUM(C4:D4)', '=SUM(E4,F4)', 30]);
  const noteText = Object.values(notes).join(' | ');
  expect(noteText).toContain(`4 | ${IND1} | 0 | 5 | ปรับให้ผ่าน`);   // หลักฐานคะแนนที่ปรับ (ก่อนข้อมูลถูกลบ)
  expect(noteText).toContain('3 | สอบปลายภาค');                       // ขาดสอบปลายภาค

  // 8) ปิดเทอม
  await expect(page.getByTestId('term-checks').getByTestId('check-uncollected')).toHaveCount(0);
  await expect(page.getByTestId('term-checks').getByTestId('check-absent')).toBeVisible();
  await page.getByTestId('term-agree').check();
  await page.getByTestId('term-confirm-name').fill('ป.4/1');
  await page.getByTestId('term-close').click();
  await expect(page.getByTestId('term-done')).toBeVisible();
  await expect(page.getByTestId('term-total-mean')).toHaveText('27.57');
  await page.screenshot({ path: join(TMP, `journey-done-${info.project.name}.png`), fullPage: true });

  // 9) หลังปิดเทอม: สมุดไม่มีคะแนนรายเลขที่ · ชุดฝึกยังเปิดและมีผลตรวจเดิม
  await page.goto('/#/classes/class-1/book');
  await expect(page.getByText('ห้องนี้ปิดเทอมแล้ว — ดูได้อย่างเดียว')).toBeVisible();
  const kept = await page.evaluate(async (id) => {
    const demo = (window as any).__itembankDemo;
    const e = await demo.getExam(id);
    return { status: e.status, classroomId: e.classroomId ?? null };
  }, practice);
  expect(kept).toEqual({ status: 'open', classroomId: null });
});
