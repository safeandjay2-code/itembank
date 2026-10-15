// ทดสอบ One Stop เฟส 2: ห้องเรียน — สร้างห้อง (70-30 แบ่งอัตโนมัติ) · ตั้งค่าห้อง · เรียงช่อง · คะแนนเต็ม · วิธีคิดคะแนน (โหมดสาธิต)
// ตัวชี้วัดปลายทาง ป.5: 10 ตัว ลำดับตามหลักสูตร ค 1.1 ป.5/8, ค 1.1 ป.5/2, ค 1.1 ป.5/9, ค 1.1 ป.5/5, ค 2.1 ป.5/3, …
import { test, expect, type Page } from '@playwright/test';
import { login } from './scanTools';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await login(page);
});

const codes = (page: Page) => page.getByTestId('column-code').allTextContents();

/** สร้างห้อง ป.5/1 นักเรียน 30 คน เลือกตัวชี้วัด n ตัวแรกของชั้น */
async function createRoom(page: Page, n: number) {
  await page.getByRole('link', { name: 'ห้องเรียน', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ห้องเรียน' })).toBeVisible();
  await page.getByRole('link', { name: '+ สร้างห้องเรียน' }).click();
  await page.getByRole('group', { name: 'เลือกชั้น' }).getByRole('button', { name: 'ป.5' }).click();
  await expect(page.getByLabel('ชื่อห้อง')).toHaveValue('ป.5/1');
  await page.getByLabel('จำนวนนักเรียน (เลขที่ 1–N)').fill('30');
  const boxes = page.getByTestId('indicator-picks').getByRole('checkbox');
  await expect(boxes).toHaveCount(10);
  for (let k = 0; k < n; k++) await boxes.nth(k).check();
  await expect(page.getByTestId('picked-counter')).toHaveText(`เลือกแล้ว ${n} ตัว`);
}

test('สร้างห้อง: ค่าเริ่มต้น 70-30 แบ่งให้ 8 ตัวชี้วัด (9×6 + 8×2) แล้วไปหน้าตั้งค่าห้อง', async ({ page }) => {
  await createRoom(page, 8);
  await expect(page.getByLabel('คะแนนรวมตัวชี้วัด')).toHaveValue('70');
  await expect(page.getByLabel('คะแนนสอบปลายภาค')).toHaveValue('30');
  await expect(page.getByTestId('pick-score')).toHaveText(['9 คะแนน', '9 คะแนน', '9 คะแนน', '9 คะแนน', '9 คะแนน', '9 คะแนน', '8 คะแนน', '8 คะแนน']);
  await expect(page.getByTestId('create-sum')).toContainText('ตัวชี้วัด 70 + ปลายภาค 30 = 100');
  // ไม่บังคับรวม 100
  await page.getByLabel('คะแนนสอบปลายภาค').fill('20');
  await expect(page.getByTestId('create-sum')).toContainText('= 90');
  await page.getByRole('button', { name: 'สร้างห้องเรียน' }).click();

  await expect(page).toHaveURL(/#\/classes\/class-1/);
  await expect(page.getByTestId('class-status')).toHaveText('สร้างห้องเรียนแล้ว');
  await expect(page.getByTestId('class-title')).toContainText('ป.5/1');
  await expect(page.getByTestId('class-title')).toContainText('ภาคเรียนที่');
  await expect(page.getByTestId('column-row')).toHaveCount(8);
  expect((await codes(page))[0]).toBe('ค 1.1 ป.5/8');
  await expect(page.getByTestId('score-total')).toContainText('ตัวชี้วัด 70');
  await expect(page.getByTestId('score-grand')).toHaveText('90');
  await expect(page.getByLabel('คะแนนเต็มสอบปลายภาค')).toHaveValue('20');

  // รายการห้อง
  await page.getByRole('link', { name: '← ห้องเรียน' }).click();
  const row = page.getByTestId('class-list').locator('li');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('ป.5/1');
  await expect(row).toContainText('นักเรียน 30 คน');
  await expect(row).toContainText('ตัวชี้วัด 8 ช่อง');
});

test('สร้างห้องโดยยังไม่เลือกตัวชี้วัด แล้วเพิ่มทีละตัว (ค่อยเป็นค่อยไป) · ชื่อห้องซ้ำในเทอมเดียวกันไม่ได้', async ({ page }) => {
  await createRoom(page, 0);
  await expect(page.getByTestId('create-sum')).toContainText('ปลายภาค 30 · ตัวชี้วัดยังไม่ตั้งคะแนน');
  await page.getByRole('button', { name: 'สร้างห้องเรียน' }).click();
  await expect(page.getByTestId('no-columns')).toBeVisible();
  await expect(page.getByTestId('score-grand')).toHaveText('30');

  await page.getByLabel('ตัวชี้วัดที่จะเพิ่ม', { exact: true }).selectOption({ index: 3 });
  await page.getByLabel('คะแนนเต็มของตัวชี้วัดที่จะเพิ่ม').fill('12');
  await page.getByRole('button', { name: '+ เพิ่ม', exact: true }).click();
  await expect(page.getByTestId('class-status')).toHaveText('เพิ่มตัวชี้วัดแล้ว');
  // เพิ่มแบบยังไม่ตั้งคะแนน
  await page.getByLabel('ตัวชี้วัดที่จะเพิ่ม', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: '+ เพิ่ม', exact: true }).click();
  await expect(page.getByTestId('column-row')).toHaveCount(2);
  await expect(page.getByTestId('score-grand')).toHaveText('42');
  await expect(page.getByTestId('unset-count')).toHaveText('ยังไม่ตั้งคะแนน 1 ช่อง');
  // ตัวที่เพิ่มแล้วไม่อยู่ในตัวเลือกอีก
  const opts = await page.getByLabel('ตัวชี้วัดที่จะเพิ่ม', { exact: true }).locator('option').allTextContents();
  for (const c of await codes(page)) expect(opts.some((o) => o.startsWith(`${c} —`))).toBe(false);
  expect(opts.length).toBe(1 + 33 - 2);   // หัวข้อ "เลือก" + ตัวชี้วัดทั้งหมดที่ยังไม่เพิ่ม

  // ห้องชื่อซ้ำในเทอมเดียวกัน
  await page.goto('/#/classes/new');
  await page.getByRole('group', { name: 'เลือกชั้น' }).getByRole('button', { name: 'ป.5' }).click();
  await page.getByLabel('จำนวนนักเรียน (เลขที่ 1–N)').fill('25');
  await page.getByRole('button', { name: 'สร้างห้องเรียน' }).click();
  await expect(page.getByRole('alert')).toContainText('มีห้อง ป.5/1');
  // จำนวนนักเรียนเกิน
  await page.getByLabel('ชื่อห้อง').fill('ป.5/2');
  await page.getByLabel('จำนวนนักเรียน (เลขที่ 1–N)').fill('61');
  await page.getByRole('button', { name: 'สร้างห้องเรียน' }).click();
  await expect(page.getByRole('alert')).toContainText('ไม่เกิน 60');
});

test('เรียงช่องตามแผนการสอน: ปุ่มขึ้น/ลง และลากวาง · แก้คะแนนเต็ม · แบ่งคะแนนใหม่ · ลบช่อง', async ({ page, isMobile }) => {
  await createRoom(page, 4);
  await page.getByRole('button', { name: 'สร้างห้องเรียน' }).click();
  await expect(page.getByTestId('column-row')).toHaveCount(4);
  const start = await codes(page);   // [A, B, C, D]
  expect(start).toEqual(['ค 1.1 ป.5/8', 'ค 1.1 ป.5/2', 'ค 1.1 ป.5/9', 'ค 1.1 ป.5/5']);

  await page.getByRole('button', { name: `เลื่อน ${start[2]} ขึ้น` }).click();
  await expect(page.getByTestId('class-status')).toHaveText('บันทึกลำดับแล้ว');
  expect(await codes(page)).toEqual([start[0], start[2], start[1], start[3]]);
  await page.getByRole('button', { name: `เลื่อน ${start[0]} ลง` }).click();
  await expect.poll(() => codes(page)).toEqual([start[2], start[0], start[1], start[3]]);
  await expect(page.getByRole('button', { name: `เลื่อน ${start[2]} ขึ้น` })).toBeDisabled();
  await expect(page.getByRole('button', { name: `เลื่อน ${start[3]} ลง` })).toBeDisabled();

  if (!isMobile) {   // ลากวาง (เมาส์) — บนมือถือใช้ปุ่มขึ้น/ลง
    const rows = page.getByTestId('column-row');
    await rows.nth(3).dragTo(rows.nth(0));
    await expect.poll(() => codes(page)).toEqual([start[3], start[2], start[0], start[1]]);
  }
  const order = await codes(page);

  // แก้คะแนนเต็ม (บันทึกเมื่อออกจากช่อง) · ว่าง = ยังไม่ตั้ง · ค่าผิดขึ้นเตือนไม่บันทึก
  const max0 = page.getByLabel(`คะแนนเต็ม ${order[0]}`);
  await max0.fill('20');
  await max0.press('Enter');
  await expect(page.getByTestId('class-status')).toHaveText('บันทึกคะแนนเต็มแล้ว');
  // 70 แบ่ง 4 = 18,18,17,17 (A,B,C,D) · ตัวแรกในลำดับใหม่ (D บนคอม / C บนมือถือ = 17) เปลี่ยนเป็น 20 → 73 + ปลายภาค 30
  await expect(page.getByTestId('score-grand')).toHaveText('103');
  const max1 = page.getByLabel(`คะแนนเต็ม ${order[1]}`);
  await max1.fill('');
  await max1.press('Enter');
  await expect(page.getByTestId('unset-count')).toHaveText('ยังไม่ตั้งคะแนน 1 ช่อง');
  await max1.fill('-3');
  await max1.press('Enter');
  await expect(page.getByTestId('column-row').nth(1).getByRole('alert')).toContainText('คะแนนต้องเป็นตัวเลข');

  // แบ่งคะแนนใหม่ทุกตัวชี้วัด 80 → 20×4 (ใช้ลำดับตามแผนการสอน)
  await page.getByLabel('คะแนนรวมที่จะแบ่ง').fill('80');
  await page.getByRole('button', { name: 'แบ่งคะแนน' }).click();
  await expect(page.getByTestId('class-status')).toHaveText('แบ่ง 80 คะแนนให้ 4 ตัวชี้วัดแล้ว');
  await expect(page.getByTestId('score-grand')).toHaveText('110');
  await expect(page.getByTestId('unset-count')).toHaveCount(0);

  // ลบช่อง (ยืนยันก่อน)
  await page.getByRole('button', { name: `ลบ ${order[0]}` }).click();
  await expect(page.getByTestId('column-row').nth(0)).toContainText('คะแนนที่ครูปรับในช่องนี้จะหาย');
  await page.getByRole('button', { name: 'ไม่ลบ' }).click();
  await expect(page.getByTestId('column-row')).toHaveCount(4);
  await page.getByRole('button', { name: `ลบ ${order[0]}` }).click();
  await page.getByRole('button', { name: 'ยืนยันลบ', exact: true }).click();
  await expect(page.getByTestId('column-row')).toHaveCount(3);
  expect(await codes(page)).toEqual(order.slice(1));
  await expect(page.getByTestId('score-grand')).toHaveText('90');
});

test('ข้อมูลห้อง · วิธีคิดคะแนน · ช่องคะแนนอื่น (ซ่อนไว้เป็นค่าเริ่มต้น) · ลบห้อง', async ({ page }) => {
  await createRoom(page, 2);
  await page.getByRole('button', { name: 'สร้างห้องเรียน' }).click();
  await expect(page.getByTestId('column-row')).toHaveCount(2);

  await page.getByLabel('ชื่อห้อง').fill('ป.5/1 ห้องเช้า');
  await page.getByLabel('จำนวนนักเรียน (เลขที่ 1–N)').fill('28');
  await page.getByRole('button', { name: 'บันทึกข้อมูลห้อง' }).click();
  await expect(page.getByTestId('class-status')).toHaveText('บันทึกข้อมูลห้องแล้ว');
  await expect(page.getByTestId('class-title')).toContainText('ป.5/1 ห้องเช้า');
  await expect(page.locator('.head-meta')).toContainText('นักเรียน 28 คน');

  const s = page.getByTestId('scoring-settings');
  await expect(s.getByLabel('การปัดคะแนน')).toHaveValue('int');
  await expect(s.getByLabel('สอบซ่อม/สอบซ้ำ นับครั้งไหน')).toHaveValue('max');
  await expect(s.getByLabel('ขาดสอบ')).toHaveValue('zero');
  await expect(s.getByText('ค่าเริ่มต้นของระบบ')).toHaveCount(5);
  await s.getByLabel('การปัดคะแนน').selectOption('1dp');
  await expect(page.getByTestId('class-status')).toHaveText('บันทึกวิธีคิดคะแนนแล้ว');
  await expect(s.getByText('ค่าเริ่มต้นของระบบ')).toHaveCount(4);
  await s.getByLabel('สอบซ่อม/สอบซ้ำ นับครั้งไหน').selectOption('latest');
  await expect(s.getByLabel('สอบซ่อม/สอบซ้ำ นับครั้งไหน')).toHaveValue('latest');

  // ช่องอื่น: ซ่อน → เปิดแสดงแล้วเพิ่มได้ → ซ่อนอีกครั้ง ช่องยังอยู่แต่ไม่นับในยอดรวม
  await expect(page.getByTestId('add-other')).toHaveCount(0);
  await s.getByLabel('ช่องคะแนนอื่น (เข้าเรียน/ส่งงาน)').selectOption('true');
  await page.getByLabel('ชื่อช่องคะแนนอื่น').fill('ส่งงาน');
  await page.getByLabel('คะแนนเต็มของช่องอื่น').fill('5');
  await page.getByRole('button', { name: '+ เพิ่มช่อง' }).click();
  await expect(page.getByTestId('column-row')).toHaveCount(3);
  await expect(page.getByLabel('ชื่อช่องคะแนน', { exact: true })).toHaveValue('ส่งงาน');
  await expect(page.getByTestId('score-grand')).toHaveText('105');
  await s.getByLabel('ช่องคะแนนอื่น (เข้าเรียน/ส่งงาน)').selectOption('false');
  await expect(page.getByTestId('column-row')).toHaveCount(2);
  await expect(page.getByText('มีช่องคะแนนอื่นที่ซ่อนอยู่ 1 ช่อง')).toBeVisible();
  await expect(page.getByTestId('score-grand')).toHaveText('100');
  // เรียงลำดับขณะช่องอื่นซ่อนอยู่ยังบันทึกได้ (ส่ง id ครบทุกช่อง)
  const before = await codes(page);
  await page.getByRole('button', { name: `เลื่อน ${before[1]} ขึ้น` }).click();
  await expect(page.getByTestId('class-status')).toHaveText('บันทึกลำดับแล้ว');
  expect(await codes(page)).toEqual([before[1], before[0]]);

  // ลบห้อง
  await page.getByRole('button', { name: 'ลบห้องเรียนนี้' }).click();
  await page.getByRole('button', { name: 'ยืนยันลบห้อง' }).click();
  await expect(page).toHaveURL(/#\/classes$/);
  await expect(page.getByText('ยังไม่มีห้องเรียน')).toBeVisible();
});
