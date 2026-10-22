// ทดสอบ One Stop เฟส 4: สมุดคะแนน (โหมดสาธิต)
//   ห้อง ป.4/1 นักเรียน 7 คน · ชุดเก็บคะแนน 6 ข้อ (IND1 4 ข้อ + IND2 2 ข้อ) · ผลตรวจใส่ผ่าน __itembankDemo.saveScan (เส้นทางเดียวกับตรวจจริง)
//   คะแนนที่รู้ล่วงหน้า (ถูก IND1/4, IND2/2): 1: 4,2 · 2: 2,1 · 3: 1,0 · 4: 0,0 · 5: 3,2 · 6: 4,2 · 7: ขาดสอบ
//   เต็ม 10 ทั้งคู่ → IND1 = 10 5 3(2.5) 0 8(7.5) 10 0 · IND2 = 10 5 0 0 10 10 0 · ต่ำกว่าเกณฑ์ 50% (คะแนนจริง): IND1 เลขที่ 3,4,7 · IND2 เลขที่ 3,4,7
import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { IND1, IND2, TMP, login, setRow } from './scanTools';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await login(page);
});

const SCORES: Record<number, [number, number]> = { 1: [4, 2], 2: [2, 1], 3: [1, 0], 4: [0, 0], 5: [3, 2], 6: [4, 2] };

async function createRoom(page: Page) {
  await page.goto('/#/classes/new');
  await page.getByRole('group', { name: 'เลือกชั้น' }).getByRole('button', { name: 'ป.4' }).click();
  await page.getByLabel('จำนวนนักเรียน (เลขที่ 1–N)').fill('7');
  await page.getByRole('button', { name: 'สร้างห้องเรียน' }).click();
  await expect(page.getByTestId('class-title')).toContainText('ป.4/1');
}

/** ชุดจากหน้าห้อง: IND1 4 ข้อ + IND2 2 ข้อ (retakeOf = ชื่อชุดเดิม ถ้าเป็นสอบซ่อม) */
async function createExam(page: Page, students: number, retakeOf?: string): Promise<string> {
  await page.goto('/#/exams/new?classroom=class-1');
  if (retakeOf) await page.getByLabel('สอบซ่อม/สอบซ้ำ').selectOption({ label: `สอบซ่อมของ: ${retakeOf}` });
  await page.getByLabel('จำนวนข้อ', { exact: true }).fill('6');
  await page.getByLabel('จำนวนชุด (กันลอก)').fill('3');
  await setRow(page, 1, IND1, 'ง่าย', 2);
  await page.getByRole('button', { name: '+ เพิ่มแถว' }).click();
  await setRow(page, 2, IND1, 'ปานกลาง', 2);
  await page.getByRole('button', { name: '+ เพิ่มแถว' }).click();
  await setRow(page, 3, IND2, 'ยาก', 2);
  await page.getByLabel('จำนวนนักเรียน (เลขที่ 1–N)').fill(String(students));
  await page.getByRole('button', { name: 'สร้างข้อสอบ' }).click();
  await expect(page.getByTestId('exam-meta')).toBeVisible();
  return /#\/exams\/([^?]+)/.exec(page.url())![1];
}

/** ใส่ผลตรวจ: เลขที่ → [จำนวนข้อถูก IND1, จำนวนข้อถูก IND2] (IND1 = ตัวชี้วัดที่มี 4 ข้อในชุด) */
async function fillScans(page: Page, id: string, scores: Record<number, [number, number]>) {
  await page.evaluate(async ({ id, scores }) => {
    const demo = (window as any).__itembankDemo;
    const exam = await demo.getExam(id);
    const indOf = new Map(exam.items.map((i: any) => [i.itemId, i.indicatorId]));
    const counts = new Map<string, number>();
    for (const i of exam.items) counts.set(i.indicatorId, (counts.get(i.indicatorId) ?? 0) + 1);
    const ind1 = [...counts].find(([, n]) => n === 4)![0];
    for (const [seatText, [a, b]] of Object.entries(scores)) {
      const seat = Number(seatText);
      const setNo = exam.seats.find((s: any) => s.seatNo === seat).setNo;
      const left = { one: a, two: b };
      const answers = exam.sets.find((s: any) => s.setNo === setNo).entries.map((e: any) => {
        const isOne = indOf.get(e.itemId) === ind1;
        const ok = isOne ? left.one-- > 0 : left.two-- > 0;
        return ok ? e.key : (e.key % 4) + 1;
      });
      await demo.saveScan(id, seat, setNo, answers);
    }
  }, { id, scores });
  await page.goto('/#/coverage');
}

const row = (page: Page, seat: number) => page.getByTestId('book-table').locator(`tbody tr[data-seat="${seat}"]`);
/** ค่าในช่องคะแนนของทุกเลขที่ (คอลัมน์ k ของช่องคะแนน) */
async function colVals(page: Page, k: number) {
  const out: string[] = [];
  for (let s = 1; s <= 7; s++) out.push((await row(page, s).locator('td.cell-td').nth(k).locator('.v').textContent()) ?? '');
  return out;
}

async function setupBook(page: Page) {
  await createRoom(page);
  const id = await createExam(page, 7);
  await fillScans(page, id, SCORES);
  await page.goto('/#/classes/class-1');
  await page.getByTestId('open-book').click();
  await expect(page).toHaveURL(/#\/classes\/class-1\/book/);
  await expect(page.getByTestId('book-title')).toContainText('สมุดคะแนน ป.4/1');
  // ห้องยังไม่มีช่องตัวชี้วัด → แจ้งให้เพิ่มเป็นช่อง
  const unplanned = page.getByTestId('alert-unplanned');
  await expect(unplanned).toHaveCount(2);
  await expect(unplanned.first()).toContainText(IND1);
  await unplanned.first().getByRole('button', { name: 'เพิ่มเป็นช่อง' }).click();
  await expect(page.getByTestId('book-status')).toContainText(`เพิ่มช่อง ${IND1} แล้ว`);
  await page.getByTestId('alert-unplanned').getByRole('button', { name: 'เพิ่มเป็นช่อง' }).click();
  await expect(page.getByTestId('alert-unplanned')).toHaveCount(0);
  await expect(page.getByTestId('alert-unset')).toContainText('ยังไม่ตั้งคะแนนเต็ม 2 ช่อง');
  // ยังไม่ตั้งคะแนนเต็ม: ไม่แปลง แต่เห็นคะแนนดิบ
  expect(await colVals(page, 0)).toEqual(['–', '–', '–', '–', '–', '–', '–']);
  await page.getByRole('group', { name: 'แสดงคะแนน' }).getByRole('button', { name: 'คะแนนดิบ (ถูก/เต็ม)' }).click();
  expect(await colVals(page, 0)).toEqual(['4/4', '2/4', '1/4', '0/4', '3/4', '4/4', '0/4']);
  await page.getByRole('group', { name: 'แสดงคะแนน' }).getByRole('button', { name: 'คะแนนลงชีท' }).click();
  // ตั้งคะแนนเต็ม 10 ทั้ง 2 ช่องที่หน้าตั้งค่าห้อง แล้วกลับมา
  await page.getByTestId('alert-unset').getByRole('link', { name: 'ตั้งคะแนน' }).click();
  for (const name of [IND1, IND2]) {
    await page.getByLabel(`คะแนนเต็ม ${name}`).fill('10');
    await page.getByLabel(`คะแนนเต็ม ${name}`).press('Enter');
    await expect(page.getByTestId('class-status')).toHaveText('บันทึกคะแนนเต็มแล้ว');
  }
  await page.getByTestId('open-book').click();
  await expect(page.getByTestId('alert-unset')).toHaveCount(0);
  return id;
}

test('สมุดคะแนน: คะแนนแปลงตามคะแนนเต็ม · ขาดสอบ · ต่ำกว่าเกณฑ์ · รวม · ตัวชี้วัดที่ยังไม่เก็บ', async ({ page }, info) => {
  await setupBook(page);
  expect(await colVals(page, 0)).toEqual(['10', '5', '3', '0', '8', '10', '0']);   // 2.5 → 3 · 7.5 → 8 (ปัดครึ่งขึ้น)
  expect(await colVals(page, 1)).toEqual(['10', '5', '0', '0', '10', '10', '0']);
  expect(await colVals(page, 2)).toEqual(['–', '–', '–', '–', '–', '–', '–']);         // ปลายภาคยังไม่สอบ
  await expect(row(page, 1).getByTestId('total-collect')).toHaveText('20');
  await expect(row(page, 5).getByTestId('total-collect')).toHaveText('18');
  await expect(row(page, 5).getByTestId('total')).toHaveText('18');
  await expect(row(page, 7).locator('td.cell-td').first()).toContainText('ขาด');
  await expect(page.getByTestId('alert-absent')).toContainText('ขาดสอบ 2 ช่อง');
  await expect(page.getByTestId('alert-uncollected')).toContainText('ยังไม่เก็บคะแนน: สอบปลายภาค');
  await expect(row(page, 3).locator('td.cell-td').first()).toHaveClass(/below/);
  await expect(row(page, 2).locator('td.cell-td').first()).not.toHaveClass(/below/);   // 5/10 = ผ่านพอดี
  await expect(page.getByTestId('book-table').locator('tfoot')).toContainText('ไม่ผ่าน');
  const belowCells = page.getByTestId('book-table').locator('tfoot [data-testid^="below-"]');
  await expect(belowCells).toHaveText(['3', '3', '0']);
  // คะแนนจริง (ก่อนปัด)
  await page.getByRole('group', { name: 'แสดงคะแนน' }).getByRole('button', { name: 'คะแนนจริง' }).click();
  expect(await colVals(page, 0)).toEqual(['10', '5', '2.5', '0', '7.5', '10', '0']);
  await page.getByRole('group', { name: 'แสดงคะแนน' }).getByRole('button', { name: 'คะแนนลงชีท' }).click();
  await page.screenshot({ path: join(TMP, `book-${info.project.name}.png`), fullPage: true });

  // รายชื่อห้องมีลิงก์ไปสมุดคะแนน
  await page.goto('/#/classes');
  await page.getByTestId('class-book-link').click();
  await expect(page.getByTestId('book-title')).toContainText('สมุดคะแนน ป.4/1');
});

test('ปรับให้ผ่าน / แก้เอง / ยกเลิก · ปรับทั้งช่อง · คะแนนจริงยังอยู่', async ({ page }, info) => {
  await setupBook(page);
  // เลขที่ 3 IND1: จริง 2.5 → ปรับให้ผ่าน 5
  await row(page, 3).locator('td.cell-td').first().getByRole('button').click();
  const panel = page.getByTestId('cell-panel');
  await expect(panel).toContainText(`เลขที่ 3 · ${IND1}`);
  await expect(panel.getByTestId('cell-real')).toContainText('2.5');
  await expect(panel.getByTestId('cell-real')).toContainText('ต่ำกว่าเกณฑ์');
  await expect(panel.getByTestId('cell-raw')).toHaveText('ถูก 1 จาก 4 ข้อ');
  await expect(panel.getByTestId('attempt')).toHaveCount(1);
  await expect(panel.getByTestId('attempt')).toContainText('1/4');
  await page.screenshot({ path: join(TMP, `book-panel-${info.project.name}.png`) });
  await panel.getByTestId('adjust-pass').click();
  await expect(page.getByTestId('book-status')).toHaveText('ปรับ เลขที่ 3 ให้ผ่าน (5) แล้ว');
  await expect(panel.getByTestId('cell-value')).toHaveText('5 / 10');
  await expect(panel.getByTestId('cell-real')).toContainText('2.5');
  await expect(panel.getByTestId('cell-adjusted')).toHaveText('5 (ปรับให้ผ่าน)');
  const c3 = row(page, 3).locator('td.cell-td').first();
  await expect(c3).toHaveClass(/adj/);
  await expect(c3).toContainText('ปรับผ่าน');
  await expect(row(page, 3).getByTestId('total-collect')).toHaveText('5');
  // แก้เป็น 4 · ค่าผิดถูกปฏิเสธ · ยกเลิกกลับเป็นคะแนนจริง
  await panel.getByLabel('ปรับเป็นคะแนน').fill('11');
  await panel.getByRole('button', { name: 'บันทึก' }).click();
  await expect(panel.getByRole('alert')).toContainText('ไม่เกินคะแนนเต็ม 10');
  await panel.getByLabel('ปรับเป็นคะแนน').fill('4');
  await panel.getByRole('button', { name: 'บันทึก' }).click();
  await expect(panel.getByTestId('cell-adjusted')).toHaveText('4 (แก้เอง)');
  await panel.getByTestId('adjust-clear').click();
  await expect(panel.getByTestId('cell-adjusted')).toHaveCount(0);
  await expect(panel.getByTestId('cell-value')).toHaveText('3 / 10');
  // ไปเลขที่ถัดไปในแผงเดียวกัน
  await panel.getByRole('button', { name: 'เลขที่ 4 →' }).click();
  await expect(panel).toContainText(`เลขที่ 4 · ${IND1}`);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // ปรับทั้งช่อง IND2: เลขที่ 3, 4, 7 ต่ำกว่าเกณฑ์
  await page.getByRole('button', { name: `ภาพรวมช่อง ${IND2}` }).click();
  const cp = page.getByTestId('column-panel');
  await expect(cp.getByTestId('col-below')).toHaveText('3 คน (เลขที่ 3, 4, 7)');
  await cp.getByTestId('bulk-pass').click();
  await cp.getByTestId('bulk-pass-confirm').click();
  await expect(page.getByTestId('book-status')).toHaveText('ปรับให้ผ่าน 3 คน แล้ว');
  await expect(cp.getByTestId('col-below')).toHaveText('0 คน');
  expect(await colVals(page, 1)).toEqual(['10', '5', '5', '5', '10', '10', '5']);
  await page.getByRole('group', { name: 'แสดงคะแนน' }).getByRole('button', { name: 'คะแนนจริง' }).click();
  expect(await colVals(page, 1)).toEqual(['10', '5', '0', '0', '10', '10', '0']);    // คะแนนจริงยังเก็บไว้
});

test('สอบซ่อม: ขาดสอบหาย · นับครั้งสูงสุด · ครูเลือกเองรายคน', async ({ page }) => {
  const root = await setupBook(page);
  const title = 'แบบทดสอบ คณิตศาสตร์ ป.4/1';
  const retake = await createExam(page, 7, title);
  expect(retake).not.toBe(root);
  // เลขที่ 7 (ขาด) สอบซ่อมได้ 4,2 · เลขที่ 3 สอบซ่อมได้ 3,1
  await fillScans(page, retake, { 7: [4, 2], 3: [3, 1] });
  await page.goto('/#/classes/class-1/book');
  expect(await colVals(page, 0)).toEqual(['10', '5', '8', '0', '8', '10', '10']);   // 3: max(1/4, 3/4) → 7.5 → 8
  await expect(row(page, 7).locator('td.cell-td').first()).not.toContainText('ขาด');
  await row(page, 3).locator('td.cell-td').first().getByRole('button').click();
  const panel = page.getByTestId('cell-panel');
  await expect(panel.getByTestId('attempt')).toHaveCount(2);
  await expect(panel.getByTestId('attempt').nth(1)).toContainText('✓ นับครั้งนี้');
  await expect(panel).toContainText('นับครั้งที่ได้สูงสุด');
  await page.keyboard.press('Escape');

  // เปลี่ยนเป็นครูเลือกเอง แล้วเลือกนับครั้งแรกของเลขที่ 3
  await page.goto('/#/classes/class-1');
  await page.getByLabel('สอบซ่อม/สอบซ้ำ นับครั้งไหน').selectOption({ label: 'ครูเลือกเองรายคน' });
  await page.getByTestId('open-book').click();
  await expect(page.getByTestId('book-policy')).toContainText('สอบซ่อม: ครูเลือกเองรายคน');
  await row(page, 3).locator('td.cell-td').first().getByRole('button').click();
  await panel.getByTestId('attempt').first().getByRole('button', { name: 'เลือกนับครั้งนี้' }).click();
  await expect(page.getByTestId('book-status')).toContainText('เลขที่ 3 นับ');
  await expect(panel.getByTestId('attempt').first()).toContainText('✓ นับครั้งนี้');
  await expect(panel.getByTestId('cell-value')).toHaveText('3 / 10');
  await panel.getByRole('button', { name: 'ยกเลิกการเลือก (นับครั้งที่ได้สูงสุด)' }).click();
  await expect(panel.getByTestId('cell-value')).toHaveText('8 / 10');
});
