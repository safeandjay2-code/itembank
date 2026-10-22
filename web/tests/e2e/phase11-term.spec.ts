// ทดสอบ One Stop เฟส 5: ส่งออกชีท (หัวข้อ 6.1) + วางรายชื่อในเบราว์เซอร์ + ปิดเทอม (โหมดสาธิต)
//   ห้อง/คะแนนตาม bookTools: IND1 = 10 5 3 0 8 10 0 · IND2 = 10 5 0 0 10 10 0 · ปลายภาค (เต็ม 30) ยังไม่สอบ
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { IND1, TMP, login } from './scanTools';
import { row, setupBook } from './bookTools';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await login(page);
});

/** ค่าในเซลล์ของแผ่นงาน (ข้อความ / ตัวเลข / สูตร) */
async function readSheet(path: string) {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const wb = await zip.file('xl/workbook.xml')!.async('string');
  const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  const cells: Record<string, string | number> = {};
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>(.*?)<\/c>)/g)) {
    const body = m[2] ?? '';
    const t = /<t[^>]*>(.*?)<\/t>/.exec(body), f = /<f>(.*?)<\/f>/.exec(body), v = /<v>(.*?)<\/v>/.exec(body);
    if (f) cells[m[1]] = `=${f[1]}`; else if (t) cells[m[1]] = t[1]; else if (v) cells[m[1]] = Number(v[1]);
  }
  return { sheets: [...wb.matchAll(/<sheet name="([^"]+)"/g)].map((x) => x[1]), cells };
}

async function openTerm(page: Page) {
  await page.getByTestId('book-export').click();
  await expect(page).toHaveURL(/#\/classes\/class-1\/close/);
  await expect(page.getByTestId('term-title')).toContainText('ส่งออกชีทและปิดเทอม: ป.4/1');
}

test('ส่งออกชีท: หัว 3 แถว · คะแนนลงชีท · สูตรรวม · รายชื่อรวมในเบราว์เซอร์ ไม่จำไว้', async ({ page }, info) => {
  await setupBook(page);
  await openTerm(page);
  await page.getByTestId('term-names').fill('1 ด.ช.กล้า ใจดี\n2\tด.ญ.ขวัญ\tรักเรียน\nด.ช.คม ต่อเลขที่ 3\n9 ด.ช.เกินห้อง');
  await expect(page.getByTestId('term-names-info')).toContainText('จับคู่ได้ 3 จาก 7 คน');
  await expect(page.getByTestId('term-names-info')).toContainText('ไม่ส่งขึ้นเซิร์ฟเวอร์');
  await expect(page.getByTestId('term-names-warn')).toContainText('เลขที่ 9 ไม่มีในห้องนี้');
  await page.getByText('ดูตัวอย่างชีท').click();
  const preview = page.getByTestId('term-preview');
  await expect(preview.locator('tbody tr').first()).toContainText('ด.ช.กล้า ใจดี');
  await expect(preview.locator('tbody tr').nth(2)).toContainText('ด.ช.คม ต่อเลขที่ 3');
  await page.screenshot({ path: join(TMP, `term-export-${info.project.name}.png`), fullPage: true });

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('term-download').click()]);
  expect(dl.suggestedFilename()).toMatch(/^คะแนน ป\.4-1 ภาค \d-25\d\d\.xlsx$/);
  const file = join(TMP, `term-${info.project.name}.xlsx`);
  await dl.saveAs(file);
  await expect(page.getByTestId('term-downloaded')).toBeVisible();
  const { sheets, cells } = await readSheet(file);
  expect(sheets).toEqual(['ป.4-1', 'บันทึก']);
  const [std, ind] = IND1.split(' ป.');
  expect([cells.A1, cells.B1, cells.C1, cells.C2, cells.C3, cells.D3, cells.E1, cells.F1, cells.F3, cells.G1]).toEqual(
    ['ที่', 'ชื่อ - สกุล', std, `ป.${ind}`, 10, 10, 'รวม', 'สอบ', 30, 'รวม']);
  expect(cells.E3).toBe('=SUM(C3:D3)');
  // เลขที่ 1–7 = แถว 4–10 · ปลายภาคยังไม่สอบ = ว่าง
  expect([4, 5, 6, 7, 8, 9, 10].map((r) => cells[`C${r}`])).toEqual([10, 5, 3, 0, 8, 10, 0]);
  expect([4, 5, 6, 7, 8, 9, 10].map((r) => cells[`D${r}`])).toEqual([10, 5, 0, 0, 10, 10, 0]);
  expect([cells.B4, cells.B5, cells.B6, cells.B7]).toEqual(['ด.ช.กล้า ใจดี', 'ด.ญ.ขวัญ รักเรียน', 'ด.ช.คม ต่อเลขที่ 3', undefined]);
  expect([cells.E4, cells.F4, cells.G4]).toEqual(['=SUM(C4:D4)', undefined, '=SUM(E4,F4)']);

  // รายชื่อไม่ถูกจำ: ออกจากหน้าแล้วกลับมา ช่องว่าง (โหมดสาธิตโหลดหน้าใหม่ไม่ได้ เพราะข้อมูลอยู่ในหน่วยความจำ)
  await page.goto('/#/classes/class-1/book');
  await openTerm(page);
  await expect(page.getByTestId('term-names')).toHaveValue('');
});

test('ปิดเทอม: เตือนเรื่องค้าง → ยืนยันด้วยชื่อห้อง → เหลือค่ารวม · ห้อง/สมุดเป็นอ่านอย่างเดียว', async ({ page }, info) => {
  await setupBook(page);
  // ปรับเลขที่ 3 IND1 ให้ผ่าน (2.5 → 5)
  await row(page, 3).locator('td.cell-td').first().getByRole('button').click();
  await page.getByTestId('cell-panel').getByTestId('adjust-pass').click();
  await expect(page.getByTestId('book-status')).toContainText('ให้ผ่าน');
  await page.keyboard.press('Escape');
  await openTerm(page);

  const checks = page.getByTestId('term-checks');
  await expect(checks.getByTestId('check-uncollected')).toContainText('สอบปลายภาค');
  await expect(checks.getByTestId('check-absent')).toContainText('ขาดสอบ 2 ช่อง');
  await expect(checks.getByTestId('check-open-exams')).toContainText('1 ชุด');
  const btn = page.getByTestId('term-close');
  await expect(btn).toBeDisabled();
  await page.getByTestId('term-agree').check();
  await expect(btn).toBeDisabled();
  await page.getByTestId('term-confirm-name').fill('ป.4/2');
  await expect(btn).toBeDisabled();
  await page.getByTestId('term-confirm-name').fill('ป.4/1');
  await expect(btn).toBeEnabled();
  await page.screenshot({ path: join(TMP, `term-close-${info.project.name}.png`), fullPage: true });
  await btn.click();

  const done = page.getByTestId('term-done');
  await expect(done).toBeVisible();
  await expect(page.getByTestId('term-title')).toContainText('ปิดเทอมแล้ว: ป.4/1');
  // รวม: 20, 10, 5(ปรับ)+0, 0, 18, 20, 0 = 73 ÷ 7 = 10.43
  await expect(page.getByTestId('term-total-mean')).toHaveText('10.43');
  await expect(done).toContainText('ปิดชุดข้อสอบที่ยังเปิดอยู่พร้อมกัน 1 ชุด');
  await expect(done).toContainText('คะแนนที่ปรับ 1 รายการ');
  const sumRows = page.getByTestId('term-summary-table').locator('tbody tr');
  await expect(sumRows.first()).toContainText(IND1);
  await expect(sumRows.first()).toContainText('5.43');     // (10+5+5+0+8+10+0) = 38 ÷ 7
  await page.screenshot({ path: join(TMP, `term-done-${info.project.name}.png`), fullPage: true });

  // เปิดหน้าเดิมอีกครั้ง = หน้าสรุป (ส่งออกไม่ได้แล้ว)
  await page.goto('/#/classes');
  await page.goto('/#/classes/class-1/close');
  await expect(page.getByTestId('term-done')).toBeVisible();
  await expect(page.getByTestId('term-download')).toHaveCount(0);
  // สมุดคะแนน: ปิดเทอมแล้ว ไม่มีคะแนนรายเลขที่
  await page.goto('/#/classes/class-1/book');
  await expect(page.getByText('ห้องนี้ปิดเทอมแล้ว — ดูได้อย่างเดียว')).toBeVisible();
  await expect(row(page, 1).locator('td.cell-td').first()).not.toContainText('10');
  await expect(page.getByTestId('book-export')).toHaveText('สรุปปิดเทอม');
  // หน้าตั้งค่าห้อง + รายการชุด
  await page.goto('/#/classes/class-1');
  await expect(page.getByTestId('open-term')).toHaveText('สรุปปิดเทอม');
  await page.goto('/#/exams');
  await expect(page.getByText('ปิดแล้ว').first()).toBeVisible();
});
