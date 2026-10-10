// ทดสอบเฟส 7: ปรับความยากอัตโนมัติ + หน้าสุขภาพคลัง (โหมดสาธิต)
// สถิติใส่ผ่าน __itembankDemo.addStats (เหมือนปิดชุด: บันทึกสถิติรอบสอบแล้วปรับความยากทันที) หรือปิดชุดจริง
// ข้อหุ่นในโหมดสาธิต: ตัวชี้วัด ค 1.1 ป.4/2 → M-000001–2 ง่าย · M-000003–4 ปานกลาง · M-000005–6 ยาก
import { test, expect, type Page } from '@playwright/test';
import { createExam, login } from './scanTools';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await login(page);
});

async function addStats(page: Page, code: string, rounds: Array<{ n: number; nCorrect: number; r: number | null; gradeId?: string }>) {
  return page.evaluate(({ code, rounds }) => (window as any).__itembankDemo.addStats(code, rounds), { code, rounds });
}

/** 3 ข้อมีสถิติครบเกณฑ์: ข้อง่ายที่จริงยาก (ย้าย) · r ติดลบ (หยุดสุ่ม) · r ต่ำ (ติดป้าย) */
async function seedStats(page: Page) {
  const a = await addStats(page, 'M-000001', [{ n: 30, nCorrect: 15, r: 0.4 }, { n: 30, nCorrect: 15, r: 0.4 }]);
  expect(a.moved).toHaveLength(1);
  expect(a.moved[0]).toMatchObject({ itemCode: 'M-000001', from: 1, to: 3, direction: 'harder' });
  expect(a.shortfalls).toHaveLength(1);
  const b = await addStats(page, 'M-000003', [{ n: 60, nCorrect: 36, r: -0.3 }]);
  expect(b.flagged[0]).toMatchObject({ itemCode: 'M-000003', flag: 'negative_r' });
  expect(b.stopped).toBe(1);
  const c = await addStats(page, 'M-000005', [{ n: 60, nCorrect: 24, r: 0.1 }, { n: 40, nCorrect: 40, r: 0.9, gradeId: 'P6' }]);
  expect(c.flagged[0]).toMatchObject({ itemCode: 'M-000005', flag: 'low_r' });
  expect(c.moved).toHaveLength(0); // สถิติชั้น ป.6 (p 1.00) ไม่นับ
}

test('สุขภาพคลัง: คลังเริ่มต้นยังไม่มีสถิติ ไม่มีแจ้งเตือน', async ({ page }) => {
  await page.getByRole('link', { name: 'สุขภาพคลัง' }).click();
  await expect(page).toHaveURL(/#\/health/);
  await expect(page.getByTestId('calib-rules')).toContainText('n ≥ 50');
  await expect(page.getByTestId('calib-rules')).toContainText('±0.05');
  await expect(page.getByTestId('calib-rules')).toContainText('r < 0.20');
  await expect(page.getByTestId('stat-calibrated')).toHaveText(/^0\s*\/\s*264 ข้อ$/);
  await expect(page.getByTestId('stat-full')).toHaveText(/^0\s*\/\s*132$/);
  await expect(page.getByTestId('health-alerts')).toHaveCount(0);
  await expect(page.getByTestId('health-flagged')).toContainText('ยังไม่มีข้อที่ค่า r ต่ำ');
  await expect(page.getByTestId('health-moves')).toContainText('ยังไม่มีการย้ายระดับ');
  // ไม่มีช่องที่ขาดเพราะข้อย้าย → แสดงทุกช่องที่ต่ำกว่าเป้า (ข้อหุ่น 2 ข้อ/ช่อง)
  await expect(page.getByTestId('shortfall-table').locator('tbody tr')).toHaveCount(132);
  await page.getByRole('group', { name: 'เลือกชั้น' }).getByRole('button', { name: 'ป.6' }).click();
  await expect(page.getByTestId('shortfall-table').locator('tbody tr')).toHaveCount(52);
});

test('ย้ายระดับ/ป้าย r → หน้าสุขภาพคลัง หน้าแรก รายการข้อ และประวัติรายข้อ', async ({ page }) => {
  await seedStats(page);
  await page.goto('/#/coverage');
  await page.goto('/#/health');
  await expect(page.getByTestId('health-alerts')).toContainText('ต้องแก้ด่วน 1 ข้อ');
  await expect(page.getByTestId('health-alerts')).toContainText('1 ช่องต่ำกว่าเป้าเพราะมีข้อย้ายออก');
  await expect(page.getByTestId('stat-calibrated')).toHaveText(/^3\s*\/\s*264 ข้อ$/);
  await expect(page.getByTestId('stat-flagged')).toHaveText(/^2\s*ข้อ · สถานะต้องแก้ 1$/);
  const flagged = page.getByTestId('health-flagged').locator('tbody tr');
  await expect(flagged).toHaveCount(2);
  await expect(flagged.nth(0)).toContainText('M-000003');           // ติดลบขึ้นก่อน
  await expect(flagged.nth(0)).toContainText('ต้องแก้ด่วน');
  await expect(flagged.nth(0)).toContainText('-0.30');
  await expect(flagged.nth(1)).toContainText('M-000005');
  await expect(flagged.nth(1)).toContainText('ตรวจแล้ว');            // r ต่ำ ยังพร้อมใช้
  const short = page.getByTestId('shortfall-table').locator('tbody tr');
  await expect(short).toHaveCount(1);                                 // ค่าเริ่มต้น: เฉพาะช่องที่มีข้อย้ายออก
  await expect(short.first()).toContainText('ค 1.1 ป.4/2');
  await expect(short.first()).toContainText('ง่าย');
  await expect(short.first()).toContainText('1/20');
  await expect(short.first().getByRole('link', { name: '+ เพิ่มข้อ' })).toHaveAttribute('href', /#\/items\/new\?ind=.+&d=1/);
  await page.getByTestId('only-moved').uncheck();
  await expect(short).toHaveCount(132);
  const moves = page.getByTestId('health-moves').locator('tbody tr');
  await expect(moves).toHaveCount(1);
  await expect(moves.first()).toContainText('M-000001');
  await expect(moves.first()).toContainText('ง่าย');
  await expect(moves.first()).toContainText('ยาก');
  await expect(moves.first()).toContainText('0.50');
  await expect(page.getByTestId('health-runs')).toContainText('ย้าย 1');

  // สั่งปรับทั้งคลังซ้ำด้วยข้อมูลเดิม → ไม่มีอะไรเปลี่ยน
  await page.getByTestId('calib-run-all').click();
  await expect(page.getByTestId('calib-result')).toContainText('ไม่มีข้อที่ต้องย้ายระดับหรือติดป้าย');

  // หน้าแรกแจ้งเตือนผู้ดูแล
  await page.getByRole('link', { name: 'หน้าแรก' }).click();
  await expect(page.getByTestId('home-bank-alerts')).toContainText('ต้องแก้ด่วน 1 ข้อ');
  await expect(page.getByTestId('home-bank-alerts')).toContainText('ค่า r ต่ำ ควรปรับปรุง 1 ข้อ');
  await expect(page.getByTestId('stat-ready')).toHaveText('263');     // ข้อ r ติดลบหยุดสุ่ม (ต้องแก้)

  // รายการข้อ: กรองตามป้าย
  await page.goto('/#/items?flag=negative_r');
  await expect(page.getByTestId('result-count')).toHaveText('พบ 1 ข้อ');
  await expect(page.getByTestId('item-list')).toContainText('M-000003');
  await expect(page.getByTestId('item-list')).toContainText('ต้องแก้ด่วน');
  await page.getByTestId('flag-filter').selectOption('any');
  await expect(page.getByTestId('result-count')).toHaveText('พบ 2 ข้อ');

  // ประวัติรายข้อ
  await page.goto('/#/items?q=M-000001');
  await page.getByTestId('item-list').getByText('M-000001').click();
  await page.getByRole('tab', { name: /ประวัติ .*และสถิติ/ }).click();
  await expect(page.getByTestId('calib-stats')).toContainText('n 60');
  await expect(page.getByTestId('calib-stats')).toContainText('p 0.50');
  await expect(page.getByTestId('calib-progress')).toContainText('สถิติครบเกณฑ์');
  await expect(page.getByTestId('calib-moves')).toContainText('ง่าย → ยาก');
  await expect(page.getByTestId('calib-moves')).toContainText('n 60');
  await expect(page.getByTestId('calib-rounds').locator('tbody tr')).toHaveCount(2);
  await expect(page.getByTestId('events')).toContainText('ย้ายระดับความยาก');

  // ข้อที่มีสถิติชั้นอื่น: แจ้งว่าไม่นำมาปรับ
  await page.goto('/#/items?q=M-000005');
  await page.getByTestId('item-list').getByText('M-000005').click();
  await page.getByRole('tab', { name: /ประวัติ .*และสถิติ/ }).click();
  await expect(page.getByTestId('calib-panel')).toContainText('มีสถิติจากชั้นอื่น 40 คน');
  await expect(page.getByTestId('calib-moves-empty')).toBeVisible();
  await expect(page.getByTestId('events')).toContainText('ป้ายคุณภาพ (ค่า r)');
});

test('ปิดชุดจริง → ปรับความยากทันที แสดงผลในหน้าปิดชุดพร้อมช่องที่ต้องเติม', async ({ page }) => {
  const id = await createExam(page);
  const exam = await page.evaluate((id) => (window as any).__itembankDemo.getExam(id), id);
  const easy = exam.items.filter((i: any) => i.difficulty === 1).map((i: any) => i.itemCode) as string[];
  // ข้อง่ายข้อแรกมีสถิติเดิม 45 คน p 0.22 (ยังไม่ถึงเกณฑ์) — ปิดชุดนี้ (6 คน) แล้วครบ 51 คน
  const pre = await addStats(page, easy[0], [{ n: 45, nCorrect: 10, r: 0.3 }]);
  expect(pre.moved).toHaveLength(0);
  await page.evaluate(async (id) => {
    const demo = (window as any).__itembankDemo;
    const ex = await demo.getExam(id);
    for (const seat of [1, 2, 3, 4, 5, 6]) {
      const setNo = ex.seats.find((s: any) => s.seatNo === seat).setNo;
      const keys = ex.sets.find((s: any) => s.setNo === setNo).entries.map((e: any) => e.key);
      await demo.saveScan(id, seat, setNo, keys.map((k: number, i: number) => (i < 7 - seat ? k : (k % 4) + 1)));
    }
  }, id);
  await page.goto('/#/coverage');
  await page.goto(`/#/exams/${id}/close`);
  await page.getByTestId('close-agree').check();
  await page.getByTestId('close-confirm').click();
  await expect(page.getByTestId('close-done')).toBeVisible();
  const cal = page.getByTestId('close-calibration');
  await expect(cal).toContainText('ย้ายระดับ 1 ข้อ');
  await expect(cal).toContainText(easy[0]);
  await expect(cal).toContainText('ง่าย →');
  await expect(page.getByTestId('calib-shortfalls')).toContainText('ค 1.1 ป.4/2');
  await expect(page.getByTestId('calib-shortfalls')).toContainText('+ เพิ่มข้อ');

  await page.goto('/#/health');
  await expect(page.getByTestId('health-runs')).toContainText('ปิดชุดข้อสอบ');
  await expect(page.getByTestId('health-moves').locator('tbody tr')).toHaveCount(1);
});

test('หน้าสุขภาพคลังบนมือถือไม่ล้นแนวนอน', async ({ page }) => {
  await seedStats(page);
  await page.goto('/#/coverage');
  await page.goto('/#/health');
  await expect(page.getByTestId('health-flagged').locator('tbody tr')).toHaveCount(2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
