import { test, expect } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('อีเมล', { exact: true }).fill('demo@itembank.local');
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill('demo1234');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
}

test('รหัสผ่านผิดต้องแจ้งเตือน และยังไม่เข้าระบบ', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('อีเมล', { exact: true }).fill('demo@itembank.local');
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.getByRole('alert')).toContainText('ไม่ถูกต้อง');
  await expect(page.getByRole('navigation')).toHaveCount(0);
});

test('ล็อกอินแล้วเห็นหน้าแรกพร้อมสถิติคลัง', async ({ page }) => {
  await login(page);
  await expect(page.getByTestId('stat-indicators')).toHaveText('33');
  await expect(page.getByTestId('stat-ready')).toHaveText('264');
});

test('ผังคลัง: ป.4/ป.5/ป.6 มีแถว 10/10/13 และ 4 ระดับ', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'ผังคลังข้อสอบ' }).click();
  const table = page.getByTestId('coverage-table');
  await expect(table.locator('thead th')).toHaveText(['ตัวชี้วัด', 'ง่าย', 'ปานกลาง', 'ยาก', 'ท้าทาย']);
  for (const [label, rows] of [['ป.4', 10], ['ป.5', 10], ['ป.6', 13]] as const) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(table.locator('tbody tr')).toHaveCount(rows);
  }
  await expect(table.locator('td.cell.low').first()).toHaveText('2');
});

test('หน้าจอไม่ล้นแนวนอน (มือถือ)', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'ผังคลังข้อสอบ' }).click();
  await expect(page.getByTestId('coverage-table')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('ออกจากระบบกลับไปหน้าล็อกอิน', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบ' })).toBeVisible();
});
