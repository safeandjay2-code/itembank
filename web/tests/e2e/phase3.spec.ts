// ทดสอบเฟส 3 แบบผู้ใช้จริง: สร้างชุดข้อสอบตามขั้นตอน §6.1 แล้วตรวจผลที่หน้ารายละเอียด (เรียง สลับ สมดุลเฉลย เลขที่) และลบชุด
import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('อีเมล', { exact: true }).fill('demo@itembank.local');
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill('demo1234');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.getByTestId('stat-ready')).toHaveText('264');
}

const IND1 = 'ค 1.1 ป.4/2', IND2 = 'ค 1.1 ป.4/11';

async function setRow(page: Page, n: number, ind: string, level: string, count: number) {
  await page.getByLabel(`ตัวชี้วัด แถว ${n}`).selectOption({ label: ind });
  await page.getByLabel(`ระดับ แถว ${n}`).selectOption({ label: level });
  await page.getByLabel(`จำนวน แถว ${n}`).fill(String(count));
}

/** สร้างชุด ป.4: 6 ข้อ 3 ชุด นักเรียน 7 คน */
async function buildExam(page: Page) {
  await page.getByRole('link', { name: 'ชุดข้อสอบ', exact: true }).click();
  await page.getByRole('link', { name: '+ สร้างชุดข้อสอบ' }).click();
  await expect(page.getByRole('heading', { name: 'สร้างชุดข้อสอบ' })).toBeVisible();
  await page.getByRole('button', { name: 'ป.4', exact: true }).click();
  await page.getByLabel('จำนวนข้อ', { exact: true }).fill('6');
  await page.getByLabel('จำนวนชุด (กันลอก)').fill('3');
  await setRow(page, 1, IND1, 'ปานกลาง', 2);
  await page.getByRole('button', { name: '+ เพิ่มแถว' }).click();
  await setRow(page, 2, IND1, 'ง่าย', 2);
  await page.getByLabel('จำนวนนักเรียน (เลขที่ 1–N)').fill('7');
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await login(page);
});

test('ตัวนับ ปุ่มสร้าง และคำเตือนข้อไม่พอ (§6.1)', async ({ page }) => {
  await buildExam(page);
  const create = page.getByRole('button', { name: 'สร้างข้อสอบ' });
  await expect(page.getByTestId('selected-counter')).toHaveText('เลือกแล้ว 4/6');
  await expect(create).toBeDisabled();
  await expect(page.getByTestId('build-errors')).toContainText('เลือกแล้ว 4 จาก 6 ข้อ — ต้องเลือกอีก 2 ข้อ');
  await expect(page.getByTestId('avail-1')).toHaveText('มีในคลัง 2 ข้อ');
  // ขอเกินที่มีในคลัง
  await page.getByRole('button', { name: '+ เพิ่มแถว' }).click();
  await setRow(page, 3, IND2, 'ยาก', 3);
  await expect(page.getByTestId('selected-counter')).toHaveText('เลือกแล้ว 7/6');
  await expect(page.getByTestId('avail-3')).toContainText('ขอ 3 ข้อ เกินที่มี');
  await expect(page.getByTestId('build-errors')).toContainText(`${IND2} ระดับยาก: ขอ 3 ข้อ แต่มีในคลังเพียง 2 ข้อ`);
  await expect(create).toBeDisabled();
  // แถวซ้ำ (ตัวชี้วัด+ระดับเดียวกัน) นับรวมกัน
  await page.getByLabel('จำนวน แถว 3').fill('1');
  await page.getByRole('button', { name: '+ เพิ่มแถว' }).click();
  await setRow(page, 4, IND2, 'ยาก', 2);
  await expect(page.getByTestId('avail-4')).toContainText('ขอ 3 ข้อ เกินที่มี');
  await page.getByRole('button', { name: 'ลบแถว 4' }).click();
  await page.getByLabel('จำนวน แถว 3').fill('2');
  await expect(page.getByTestId('selected-counter')).toHaveText('เลือกแล้ว 6/6');
  await expect(create).toBeEnabled();
  // จำนวนชุดเกินตั้งค่า
  await page.getByLabel('จำนวนชุด (กันลอก)').fill('11');
  await expect(create).toBeDisabled();
  await expect(page.getByTestId('build-errors')).toContainText('จำนวนชุดต้องอยู่ระหว่าง 1–10');
});

test('สร้างชุดข้อสอบ แล้วตรวจลำดับ การสลับ สมดุลเฉลย และเลขที่ (§6.2–6.4)', async ({ page }) => {
  await buildExam(page);
  await page.getByRole('button', { name: '+ เพิ่มแถว' }).click();
  await setRow(page, 3, IND2, 'ยาก', 2);
  await page.getByRole('button', { name: 'สร้างข้อสอบ' }).click();

  await expect(page.getByRole('status')).toContainText('สร้างชุดข้อสอบเรียบร้อย');
  await expect(page.getByTestId('exam-meta')).toContainText('ป.4 · 6 ข้อ · 3 ชุด · นักเรียน 7 คน');
  await expect(page.getByTestId('exam-notices')).toContainText('ยังไม่มีข้อยึดค่า');
  await expect(page.getByTestId('stat-anchor')).toHaveText('0');

  // ทุกชุด: เรียงตามตัวชี้วัด แล้วง่าย→ยาก
  const expectedInd = [IND1, IND1, IND1, IND1, IND2, IND2];
  const expectedLevel = ['ง่าย', 'ง่าย', 'ปานกลาง', 'ปานกลาง', 'ยาก', 'ยาก'];
  for (const s of [1, 2, 3]) {
    await page.getByRole('button', { name: `ชุดที่ ${s}`, exact: true }).click();
    const rows = page.getByTestId('set-table').locator('tbody tr');
    await expect(rows).toHaveCount(6);
    const cells = await rows.evaluateAll((trs) => trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? '')));
    expect(cells.map((c) => c[0])).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(cells.map((c) => c[3])).toEqual(expectedInd);
    expect(cells.map((c) => c[4])).toEqual(expectedLevel);
    expect(cells.every((c) => ['①', '②', '③', '④'].includes(c[1]))).toBe(true);
  }
  // สมดุลเฉลย: 6 ข้อ ไม่มีห้ามสลับ → แต่ละชุดต่างกันไม่เกิน 1 (2/2/1/1)
  const balance = await page.getByTestId('balance').locator('tbody tr').evaluateAll((trs) =>
    trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => Number(td.textContent))));
  expect(balance).toHaveLength(3);
  for (const c of balance) {
    expect(c.reduce((a, b) => a + b, 0)).toBe(6);
    expect(Math.max(...c) - Math.min(...c)).toBeLessThanOrEqual(1);
  }
  // เลขที่ → ชุด วนรอบ
  const seats = await page.getByTestId('seats').locator('li span').allInnerTexts();
  expect(seats).toEqual(['ชุด 1', 'ชุด 2', 'ชุด 3', 'ชุด 1', 'ชุด 2', 'ชุด 3', 'ชุด 1']);
  // ข้อในชุด 6 ข้อ เปิดไปหน้าแก้ข้อได้
  await expect(page.getByTestId('exam-items').locator('li')).toHaveCount(6);

  // ข้อที่ถูกใช้เปลี่ยนเป็น "ใช้งาน"
  await page.goto('/#/items?s=active');
  await expect(page.getByTestId('result-count')).toHaveText('พบ 6 ข้อ');

  // รายการชุดข้อสอบ → ลบชุด
  await page.getByRole('link', { name: 'ชุดข้อสอบ', exact: true }).click();
  await expect(page.getByTestId('exam-list').locator('li')).toHaveCount(1);
  await expect(page.getByTestId('exam-list')).toContainText('แบบทดสอบ คณิตศาสตร์ ป.4');
  await expect(page.getByTestId('exam-list')).toContainText('3 ชุด');
  await page.getByTestId('exam-list').getByRole('link').first().click();
  await page.getByRole('button', { name: 'ลบชุดข้อสอบนี้…' }).click();
  await page.getByRole('button', { name: 'ยืนยันลบ' }).click();
  await expect(page.getByText('ยังไม่มีชุดข้อสอบ')).toBeVisible();
});

test('ชุดที่ไม่มีอยู่', async ({ page }) => {
  await page.goto('/#/exams/ไม่มีชุดนี้');
  await expect(page.getByText('ไม่พบชุดข้อสอบนี้')).toBeVisible();
});

test('มือถือ/จอแคบ: ไม่ล้นแนวนอนทั้งหน้าสร้างและหน้ารายละเอียด', async ({ page }) => {
  await buildExam(page);
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(await noOverflow()).toBe(true);
  await page.getByRole('button', { name: '+ เพิ่มแถว' }).click();
  await setRow(page, 3, IND2, 'ยาก', 2);
  await page.getByRole('button', { name: 'สร้างข้อสอบ' }).click();
  await expect(page.getByTestId('exam-meta')).toBeVisible();
  expect(await noOverflow()).toBe(true);
});
