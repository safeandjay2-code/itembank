// เครื่องมือร่วมของทดสอบสมุดคะแนน (One Stop เฟส 4–5) — ห้อง ป.4/1 นักเรียน 7 คน + ชุดเก็บคะแนน IND1 4 ข้อ / IND2 2 ข้อ
//   คะแนนที่รู้ล่วงหน้า (ถูก IND1/4, IND2/2): 1: 4,2 · 2: 2,1 · 3: 1,0 · 4: 0,0 · 5: 3,2 · 6: 4,2 · 7: ขาดสอบ
//   เต็ม 10 ทั้งคู่ → IND1 = 10 5 3(2.5) 0 8(7.5) 10 0 · IND2 = 10 5 0 0 10 10 0
import { expect, type Page } from '@playwright/test';
import { IND1, IND2, setRow } from './scanTools';

export const SCORES: Record<number, [number, number]> = { 1: [4, 2], 2: [2, 1], 3: [1, 0], 4: [0, 0], 5: [3, 2], 6: [4, 2] };

export async function createRoom(page: Page) {
  await page.goto('/#/classes/new');
  await page.getByRole('group', { name: 'เลือกชั้น' }).getByRole('button', { name: 'ป.4' }).click();
  await page.getByLabel('จำนวนนักเรียน (เลขที่ 1–N)').fill('7');
  await page.getByRole('button', { name: 'สร้างห้องเรียน' }).click();
  await expect(page.getByTestId('class-title')).toContainText('ป.4/1');
}

/** ชุดจากหน้าห้อง: IND1 4 ข้อ + IND2 2 ข้อ (retakeOf = ชื่อชุดเดิม ถ้าเป็นสอบซ่อม) */
export async function createExam(page: Page, students: number, retakeOf?: string): Promise<string> {
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
export async function fillScans(page: Page, id: string, scores: Record<number, [number, number]>) {
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

export const row = (page: Page, seat: number) => page.getByTestId('book-table').locator(`tbody tr[data-seat="${seat}"]`);
/** ค่าในช่องคะแนนของทุกเลขที่ (คอลัมน์ k ของช่องคะแนน) */
export async function colVals(page: Page, k: number) {
  const out: string[] = [];
  for (let s = 1; s <= 7; s++) out.push((await row(page, s).locator('td.cell-td').nth(k).locator('.v').textContent()) ?? '');
  return out;
}

export async function setupBook(page: Page) {
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

