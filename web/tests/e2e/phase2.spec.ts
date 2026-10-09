// ทดสอบเฟส 2 แบบผู้ใช้จริง: ค้นหา เพิ่ม แก้ไข เวอร์ชัน สถานะ ลบ รูป ตรวจคุณภาพ สำรอง/นำเข้า
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('อีเมล', { exact: true }).fill('demo@itembank.local');
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill('demo1234');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.getByTestId('stat-ready')).toHaveText('264');
}

async function count(page: Page) {
  const t = await page.getByTestId('result-count').innerText();
  return Number(t.replace(/[^\d]/g, ''));
}

/** กรอกข้อสอบเศษส่วนที่ถูกต้องครบ */
async function fillGoodItem(page: Page, stem = 'ผลบวกของ 3/4 กับ 1/8 เท่ากับเท่าใด') {
  await page.getByLabel('ตัวชี้วัด').selectOption({ index: 1 });
  await page.getByLabel('โจทย์').fill(stem);
  const opts = ['7/8', '4/12', '1 1/8', '5/8'];
  for (let i = 0; i < 4; i++) await page.getByLabel(`ตัวเลือก ${i + 1}`, { exact: true }).fill(opts[i]);
  await page.getByLabel('เฉลยตัวเลือก 1').check();
  for (const [i, r] of [[2, 'บวกเศษกับเศษ ส่วนกับส่วน'], [3, 'บวกเกิน'], [4, 'ลบแทนบวก']] as const)
    await page.getByLabel(`เหตุผลตัวลวง ${i}`).fill(r);
  await page.getByLabel('นิพจน์คำนวณเฉลย').fill('3/4 + 1/8');
  await page.getByLabel('วิธีคิด').fill('ทำส่วนให้เท่ากัน 6/8 + 1/8 = 7/8');
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await login(page);
});

test('ค้นหาและกรองข้อในคลัง', async ({ page }) => {
  await page.getByRole('link', { name: 'คลังข้อสอบ', exact: true }).click();
  await expect(page.getByTestId('result-count')).toHaveText('พบ 264 ข้อ');
  await page.getByRole('button', { name: 'ป.5', exact: true }).click();
  await expect(page.getByTestId('result-count')).toHaveText('พบ 80 ข้อ');
  await page.getByLabel('ตัวชี้วัด').selectOption({ label: 'ค 1.1 ป.5/2' });
  await page.getByLabel('ความยาก').selectOption({ label: 'ท้าทาย' });
  await expect(page.getByTestId('result-count')).toHaveText('พบ 2 ข้อ');
  await expect(page.getByTestId('item-list').locator('li')).toHaveCount(2);
  await page.getByLabel('คำค้น').fill('#02');
  await page.getByRole('button', { name: 'ค้นหา' }).click();
  await expect(page.getByTestId('result-count')).toHaveText('พบ 1 ข้อ');
  await expect(page.getByTestId('item-list')).toContainText('ระดับท้าทาย #02');
  await page.getByLabel('แสดงข้อหุ่น').uncheck();
  await expect(page.getByTestId('result-count')).toHaveText('พบ 0 ข้อ');
  await expect(page.getByText('ไม่พบข้อสอบตามเงื่อนไข')).toBeVisible();
});

test('แบ่งหน้ารายการ', async ({ page }) => {
  await page.goto('/#/items');
  await expect(page.getByText('หน้า 1 / 9')).toBeVisible();
  await page.getByRole('button', { name: 'ถัดไป ›' }).click();
  await expect(page.getByText('หน้า 2 / 9')).toBeVisible();
  await expect(page.getByTestId('item-list').locator('li').first()).toContainText('M-000031');
  await page.getByRole('button', { name: '‹ ก่อนหน้า' }).click();
  await expect(page.getByText('หน้า 1 / 9')).toBeVisible();
});

test('กดช่องในผังความครบ → ไปรายการข้อของช่องนั้น', async ({ page }) => {
  await page.getByRole('link', { name: 'ผังคลังข้อสอบ' }).click();
  await page.getByRole('link', { name: /ค 1.1 ป.4\/11 ยาก: พร้อมใช้ 2 ข้อ/ }).click();
  await expect(page.getByTestId('result-count')).toHaveText('พบ 2 ข้อ');
  await expect(page.getByLabel('ตัวชี้วัด')).toHaveValue('MATH-2560-P4-02');
  await expect(page.getByLabel('ความยาก')).toHaveValue('3');
});

test('เพิ่มข้อใหม่: ตรวจคุณภาพสด, เฉลยผิดถูกจับได้, บันทึกและยืนยันตรวจแล้ว', async ({ page }) => {
  await page.goto('/#/items/new?ind=MATH-2560-P4-01&d=2');
  await expect(page.getByLabel('ตัวชี้วัด')).toHaveValue('MATH-2560-P4-01');
  await expect(page.getByLabel('ความยากคาดการณ์')).toHaveValue('2');
  await expect(page.getByTestId('qa-status')).toContainText('ยังไม่ผ่าน');
  await fillGoodItem(page);
  await page.getByLabel('ตัวชี้วัด').selectOption('MATH-2560-P4-01');
  await expect(page.getByTestId('check-result')).toHaveText('ผลคำนวณ = 0.875');
  await expect(page.getByTestId('qa-status')).toHaveText('✓ ผ่าน');

  // เลือกเฉลยผิด → ระบบจับได้ และยืนยันตรวจแล้วไม่ได้
  await page.getByLabel('เฉลยตัวเลือก 3').check();
  await expect(page.getByTestId('qa-panel')).toContainText('เฉลยเป็นตัวเลือก 3 แต่ผลคำนวณตรงกับตัวเลือก 1');
  await expect(page.getByRole('button', { name: 'บันทึกและยืนยันตรวจแล้ว' })).toBeDisabled();
  // ตัวเลือกค่าเท่ากัน → ถูกได้ 2 ข้อ
  await page.getByLabel('เฉลยตัวเลือก 1').check();
  await page.getByLabel('ตัวเลือก 2', { exact: true }).fill('0.875');
  await expect(page.getByTestId('qa-panel')).toContainText('ถูกได้มากกว่า 1 ข้อ');
  await page.getByLabel('ตัวเลือก 2', { exact: true }).fill('4/12');
  await expect(page.getByTestId('qa-status')).toHaveText('✓ ผ่าน');
  await expect(page.getByTestId('item-preview')).toContainText('1) 7/8');

  await page.getByRole('button', { name: 'บันทึกและยืนยันตรวจแล้ว' }).click();
  await expect(page.getByRole('status')).toContainText('บันทึกข้อใหม่แล้ว (M-000265)');
  await expect(page.getByRole('status')).toContainText('ยืนยันตรวจแล้ว');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('ข้อ M-000265');
  await expect(page.locator('.head-meta .chip').first()).toHaveText('ตรวจแล้ว');

  // ผังความครบนับข้อใหม่
  await page.getByRole('link', { name: 'ผังคลังข้อสอบ' }).click();
  await expect(page.getByRole('link', { name: /ค 1.1 ป.4\/2 ปานกลาง: พร้อมใช้ 3 ข้อ/ })).toBeVisible();
});

test('กฎเวอร์ชัน: แก้คำผิด = เวอร์ชันเดิม, แก้ตัวเลข = เวอร์ชันใหม่และกลับเป็นร่าง', async ({ page }) => {
  await page.goto('/#/items/new');
  await fillGoodItem(page);
  await page.getByRole('button', { name: 'บันทึกและยืนยันตรวจแล้ว' }).click();
  await expect(page.getByRole('status')).toContainText('M-000265');
  await expect(page.getByRole('button', { name: 'บันทึก', exact: true })).toBeDisabled();

  // แก้คำ (ตัวเลขเดิม) → ค่าเริ่มต้นเป็นเวอร์ชันเดิม
  await page.getByLabel('โจทย์').fill('ผลบวกของ 3/4 และ 1/8 มีค่าเท่าใด');
  await expect(page.getByRole('radio', { name: /เวอร์ชันเดิม/ })).toBeChecked();
  await page.getByLabel('บันทึกการแก้ไข').fill('แก้คำในโจทย์');
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('บันทึกแล้ว (เวอร์ชันเดิม)');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('เวอร์ชัน 1');
  await expect(page.locator('.head-meta .chip').first()).toHaveText('ตรวจแล้ว');

  // แก้ตัวเลข → บังคับเวอร์ชันใหม่ พร้อมเหตุผล
  await page.getByLabel('โจทย์').fill('ผลบวกของ 2/3 และ 1/6 มีค่าเท่าใด');
  for (const [i, v] of [[1, '5/6'], [2, '3/9'], [3, '1 1/6'], [4, '1/2']] as const) await page.getByLabel(`ตัวเลือก ${i}`, { exact: true }).fill(v);
  await page.getByLabel('นิพจน์คำนวณเฉลย').fill('2/3 + 1/6');
  await expect(page.getByRole('radio', { name: /เวอร์ชันเดิม/ })).toBeDisabled();
  await expect(page.getByRole('radio', { name: /ขึ้นเวอร์ชัน 2/ })).toBeChecked();
  await expect(page.getByTestId('major-reasons')).toContainText('ตัวเลขในโจทย์เปลี่ยน');
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('บันทึกเป็นเวอร์ชัน 2 แล้ว');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('เวอร์ชัน 2');
  await expect(page.locator('.head-meta .chip').first()).toHaveText('ร่าง');

  // ประวัติ: 2 เวอร์ชัน ดูเวอร์ชันเก่าได้
  await page.getByRole('tab', { name: /ประวัติ \(2 เวอร์ชัน\)/ }).click();
  await expect(page.getByTestId('events')).toContainText('ขึ้นเวอร์ชันใหม่');
  await expect(page.getByTestId('events')).toContainText('แก้คำผิด/รูปแบบ (เวอร์ชันเดิม)');
  await page.getByRole('button', { name: 'v1' }).click();
  await expect(page.getByTestId('item-preview')).toContainText('ผลบวกของ 3/4 และ 1/8 มีค่าเท่าใด');

  // สถานะ: ยืนยันตรวจแล้ว → เลิกใช้
  await page.getByRole('tab', { name: 'แก้ไข' }).click();
  await page.getByRole('button', { name: 'ตั้งเป็น "ตรวจแล้ว"' }).click();
  await expect(page.getByRole('status')).toHaveText('เปลี่ยนสถานะเป็น "ตรวจแล้ว" แล้ว');
  await page.getByRole('button', { name: 'ตั้งเป็น "เลิกใช้"' }).click();
  await expect(page.locator('.head-meta .chip').first()).toHaveText('เลิกใช้');
});

test('ข้อที่ไม่ผ่านตรวจ: บันทึกเป็นร่างได้ แต่ยืนยันตรวจแล้วไม่ได้ และลบได้', async ({ page }) => {
  await page.goto('/#/items/new?ind=MATH-2560-P6-03');
  await page.getByLabel('โจทย์').fill('ข้อที่ยังไม่เสร็จ');
  await page.getByLabel('ตัวเลือก 1', { exact: true }).fill('ก');
  await page.getByLabel('เฉลยตัวเลือก 1').check();
  await expect(page.getByTestId('qa-panel')).toContainText('ตัวเลือก 2 ว่าง');
  await page.getByRole('button', { name: 'บันทึกเป็นร่าง' }).click();
  await expect(page.getByRole('status')).toContainText('บันทึกข้อใหม่แล้ว');
  await expect(page.getByRole('button', { name: 'ตั้งเป็น "ตรวจแล้ว"' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'ตั้งเป็น "ใช้งาน"' })).toBeDisabled();
  await page.getByRole('button', { name: 'ลบข้อนี้…' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'ยกเลิก' }).click();
  await page.getByRole('button', { name: 'ลบข้อนี้…' }).click();
  await page.getByRole('button', { name: 'ยืนยันลบ' }).click();
  await expect(page.getByTestId('result-count')).toHaveText('พบ 8 ข้อ');
});

test('ตัวแก้ไขรูป: ทุกชนิดวาดได้, ข้อกำหนดผิดถูกแจ้ง, แก้แบบ JSON ได้', async ({ page }) => {
  await page.goto('/#/items/new');
  const kind = page.getByLabel('ชนิดรูป');
  const kinds = await kind.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  expect(kinds.length).toBe(15);
  for (const k of kinds) {
    await kind.selectOption(k);
    await expect(page.getByTestId('figure').locator('svg')).toBeVisible();
    await expect(page.getByTestId('figure-error')).toHaveCount(0);
  }
  // สามเหลี่ยม: เปลี่ยนเป็นด้าน 3 ด้านที่สร้างไม่ได้
  await kind.selectOption('triangle');
  await page.getByLabel('กำหนดด้วย').selectOption('SSS');
  await page.getByLabel('ด้าน AB', { exact: true }).fill('1');
  await page.getByLabel('ด้าน BC', { exact: true }).fill('2');
  await page.getByLabel('ด้าน CA', { exact: true }).fill('5');
  await expect(page.getByTestId('figure-error')).toContainText('ผลบวกสองด้าน');
  await expect(page.getByTestId('qa-panel')).toContainText('รูป: ความยาวด้านสร้างสามเหลี่ยมไม่ได้');
  await page.getByLabel('ด้าน CA', { exact: true }).fill('2.5');
  await expect(page.getByTestId('figure-error')).toHaveCount(0);
  // ป้ายเป็นข้อความเอง
  await page.getByLabel('ป้ายด้าน CA', { exact: true }).selectOption('text');
  await page.getByLabel('ป้ายด้าน CA (ข้อความ)').fill('x');
  await expect(page.getByTestId('figure').locator('text', { hasText: /^x$/ })).toHaveCount(1);
  await expect(page.getByTestId('figure')).toContainText('รูปอาจไม่ได้วาดตามมาตราส่วน ให้ใช้ขนาดที่กำหนดให้');
  // รูปประกอบด้วยรายการเส้นรอบรูป
  await kind.selectOption('rectilinear');
  await page.getByLabel('เส้นรอบรูป').fill('R8 U3 L8 D2');
  await expect(page.getByTestId('figure-error')).toContainText('ไม่บรรจบ');
  await page.getByLabel('เส้นรอบรูป').fill('R8 U3 L8 D3');
  await expect(page.getByTestId('figure-error')).toHaveCount(0);
  // JSON
  await page.getByLabel('แก้แบบ JSON').check();
  await page.getByLabel('ข้อกำหนดรูป JSON').fill('{"kind":"circle","radius":5,"unit":"ม.","show":"diameter","label":true}');
  await expect(page.getByTestId('figure')).toContainText('10 ม.');
  await page.getByLabel('ข้อกำหนดรูป JSON').fill('{"kind":');
  await expect(page.getByText(/JSON ไม่ถูกต้อง/)).toBeVisible();
  await kind.selectOption('');
  await expect(page.getByTestId('figure')).toHaveCount(0);
});

test('สำรองคลังและนำเข้า (กู้คืนซ้ำ = ข้าม, แม่แบบข้อใหม่ = เพิ่มเป็นร่าง)', async ({ page }) => {
  // มีข้อจริง 1 ข้อ
  await page.goto('/#/items/new');
  await fillGoodItem(page);
  await page.getByRole('button', { name: 'บันทึกเป็นร่าง' }).click();
  await expect(page.getByRole('status')).toContainText('M-000265');

  await page.getByRole('link', { name: 'สำรอง/นำเข้า' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'ดาวน์โหลดไฟล์สำรอง' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^itembank-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const backup = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  expect(backup.format).toBe('itembank.bank.v1');
  expect(backup.item_count).toBe(1);
  expect(backup.items[0].item_code).toBe('M-000265');
  expect(backup.items[0].versions[0].content.check).toBe('3/4 + 1/8');
  await expect(page.getByRole('status')).toHaveText('ดาวน์โหลดไฟล์สำรองแล้ว 1 ข้อ');

  // นำเข้าไฟล์เดิม → ทดลอง: ข้าม 1
  await page.getByLabel('เลือกไฟล์นำเข้า').setInputFiles(await dl.path() as string);
  await expect(page.getByTestId('import-report')).toContainText('ผลการทดลองนำเข้า');
  await expect(page.getByTestId('import-inserted')).toHaveText('จะเพิ่ม 0 ข้อ');
  await expect(page.getByTestId('import-report')).toContainText('ข้าม 1 ข้อ');

  // แม่แบบข้อใหม่ + ข้อเสีย 1 ข้อ
  const [tpl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'ดาวน์โหลดแม่แบบไฟล์นำเข้า' }).click()]);
  const doc = JSON.parse(readFileSync(await tpl.path(), 'utf8'));
  doc.items.push({ indicator_code: 'ไม่มีจริง', cognitive_level: 1, est_difficulty: 1, content: { stem: 'x', options: ['1', '2', '3', '4'] }, answer: { choice: 1 } });
  const file = join(tmpdir(), `itembank-import-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(doc));
  await page.getByLabel('เลือกไฟล์นำเข้า').setInputFiles(file);
  await expect(page.getByTestId('import-inserted')).toHaveText('จะเพิ่ม 1 ข้อ');
  await expect(page.getByTestId('import-report')).toContainText('รายการที่ 2: ไม่พบตัวชี้วัด ไม่มีจริง');
  await expect(page.getByText(/ตรวจคุณภาพให้ 2 เวอร์ชัน/)).toBeVisible();
  await page.getByRole('button', { name: 'นำเข้าจริง 1 ข้อ' }).click();
  await expect(page.getByTestId('import-inserted')).toHaveText('เพิ่มแล้ว 1 ข้อ');

  await page.goto('/#/items?sample=0');
  await expect(page.getByTestId('result-count')).toHaveText('พบ 2 ข้อ');
  await page.getByText('ผลบวกของ 1,250 และ 3,475').click();
  await expect(page.locator('.head-meta .chip').first()).toHaveText('ร่าง');
  await expect(page.getByTestId('qa-status')).toHaveText('✓ ผ่าน');
});

test('หน้าแก้ไขไม่ล้นแนวนอน', async ({ page }) => {
  await page.goto('/#/items/new');
  await page.getByLabel('ชนิดรูป').selectOption('bar_chart');
  await expect(page.getByTestId('figure').locator('svg')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('ลิงก์ข้อที่ไม่มีจริง', async ({ page }) => {
  await page.goto('/#/items/item-M-999999');
  await expect(page.getByText('ไม่พบข้อสอบนี้')).toBeVisible();
});
