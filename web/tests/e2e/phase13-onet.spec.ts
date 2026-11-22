// ห้อง O-NET เฟส 4 (SPEC-ONET §9): ครูสมัครเอง → ฟรี 2 ชุด → สแกน → รายงาน → ผู้ดูแลปลดล็อก → ใช้ชุด 3
//   + บัญชี onet เข้าหน้าระบบหลักไม่ได้ · ชุดสาธิตใช้เฉลยปลอม (onetDemoKey) ไม่ใช่เฉลยจริง
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { loadSheets, loginAs, marksFor, onetDemoKey, onetPhotoFile, signOut } from './onetTools';

test.beforeEach(async ({ page }) => { page.on('pageerror', (e) => { throw e; }); });

test('เส้นทางเต็ม: ฟรี 2 ชุด → สแกน → รายงาน → ปลดล็อก → ชุดที่ 3 · เข้าระบบหลักไม่ได้', async ({ page }) => {
  test.setTimeout(120_000);
  await loginAs(page, 'onet@itembank.local');
  await expect(page.getByRole('heading', { name: 'ห้อง O-NET คณิตศาสตร์ ป.6' })).toBeVisible();
  await loadSheets(page);
  const nav = page.getByRole('navigation', { name: 'เมนูหลัก' });
  await expect(nav.getByRole('link')).toHaveText(['ชุดติว O-NET', 'ห้องของฉัน']);
  await expect(page.getByTestId('set-S01')).toHaveAttribute('data-usable', 'true');
  await expect(page.getByTestId('set-S02')).toHaveAttribute('data-usable', 'true');
  await expect(page.getByTestId('set-S03')).toHaveAttribute('data-usable', 'false');
  await expect(page.getByTestId('lock-panel')).toContainText('onet@itembank.local');
  // ลิงก์ในข้อความชำระเงิน (เช่น แอดเพื่อน LINE) กดได้ เปิดแท็บใหม่
  await expect(page.getByTestId('payment-text').getByRole('link')).toHaveAttribute('href', 'https://line.me/R/ti/p/@demo');

  // ระบบหลักเข้าไม่ได้: ทุกเส้นทางพากลับห้อง O-NET
  for (const p of ['/#/items', '/#/exams/new', '/#/classes', '/#/onet/admin']) {
    await page.evaluate((h) => { location.hash = h.slice(1); }, p);
    await expect(page.getByTestId('onet-only')).toBeVisible();
    await expect(nav.getByRole('link', { name: 'คลังข้อสอบ' })).toHaveCount(0);
  }

  // ชุดล็อก: ไม่มีปุ่มไฟล์ · ชุดฟรี: มีไฟล์ + สไลด์ในแอป + กระดาษคำตอบ
  await page.evaluate(() => { location.hash = '/onet/sets/S03'; });
  await expect(page.getByTestId('lock-panel')).toBeVisible();
  await expect(page.getByTestId('set-actions')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '/onet/sets/S01'; });
  await expect(page.getByTestId('set-actions')).toBeVisible();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ข้อสอบ (PDF)' }).click();
  expect((await dl).suggestedFilename()).toBe('ONET-P6-คณิต-ชุดที่1-ข้อสอบ.pdf');
  await page.getByRole('link', { name: 'เปิดสไลด์เฉลย' }).click();
  await expect(page.frameLocator('[data-testid=slides-frame]').locator('#t')).toHaveText('สไลด์เฉลยสาธิต ชุดที่ 1');
  await page.evaluate(() => { location.hash = '/onet/sets/S01/sheet'; });
  await expect(page.getByTestId('onet-sheet').locator('svg')).toBeVisible();

  // สร้างห้อง → สแกนด้วยการอัปโหลด
  await page.getByRole('link', { name: 'ห้องของฉัน' }).click();
  await page.getByLabel('ชื่อห้องใหม่').fill('ป.6/1 ปี 2569');
  await page.getByTestId('room-create').click();
  await expect(page.getByRole('heading', { name: 'สแกน · ป.6/1 ปี 2569' })).toBeVisible();
  await page.getByRole('button', { name: 'อัปโหลดภาพ/PDF' }).click();
  const k1 = onetDemoKey(1);
  await page.getByTestId('onet-upload-input').setInputFiles(onetPhotoFile(1, marksFor(1, [0, 7], k1)));
  await expect(page.getByTestId('onet-last')).toContainText('เลขที่ 7 · ชุดที่ 1 · 100 คะแนน', { timeout: 20_000 });

  // ลืมระบาย 0 หลักสิบ → ถามครู (เดาเลขที่ 5) · ข้อ 1–2 ผิด
  const wrong = [...k1];
  wrong[0] = String((Number(k1[0]) % 4) + 1); wrong[1] = String((Number(k1[1]) % 4) + 1);
  await page.getByTestId('onet-upload-input').setInputFiles(onetPhotoFile(1, marksFor(1, [null, 5], wrong)));
  const ask = page.getByTestId('onet-ask');
  await expect(ask).toContainText('พิมพ์เลขที่', { timeout: 20_000 });
  await expect(ask.getByLabel('เลขที่')).toHaveValue('5');
  await ask.getByRole('button', { name: 'บันทึกเลขที่ 5' }).click();
  await expect(page.getByTestId('onet-last')).toContainText('เลขที่ 5 · ชุดที่ 1 · 87 คะแนน');

  // เลขที่ซ้ำ → ถาม → ใช้ผลใหม่
  await page.getByTestId('onet-upload-input').setInputFiles(onetPhotoFile(1, marksFor(1, [0, 7], wrong), { rotate: -3 }));
  await expect(ask).toContainText('เลขที่ 7 ชุดที่ 1 สแกนไปแล้ว', { timeout: 20_000 });
  await ask.getByRole('button', { name: 'ใช้ผลใหม่ (แทนที่)' }).click();
  await expect(page.getByTestId('onet-last')).toContainText('แทนที่ผลเดิมแล้ว');
  await page.getByRole('button', { name: /ผลในห้อง/ }).click();
  await expect(page.getByTestId('onet-results-S01').locator('tbody tr')).toHaveCount(2);

  // รายงาน
  await page.getByRole('link', { name: 'รายงาน' }).click();
  await expect(page.getByTestId('onet-report-meta')).toContainText('นักเรียน 2 คน · 2 แผ่น');
  await expect(page.getByTestId('onet-set-avg')).toContainText('87');
  await page.getByRole('button', { name: 'รายคน' }).click();
  await expect(page.getByTestId('onet-students').locator('tbody tr')).toHaveCount(2);
  await page.getByTestId('onet-students').getByRole('link', { name: 'ดู' }).first().click();
  await expect(page.getByTestId('onet-student')).toContainText('เลขที่ 5');
  await expect(page.getByTestId('onet-focus').locator('li').first()).toContainText('ผิด');
  const xl = page.waitForEvent('download');
  await page.getByTestId('onet-export').click();
  const file = await (await xl).path();
  const zip = await JSZip.loadAsync(readFileSync(file!));
  expect(await zip.file('xl/workbook.xml')!.async('string')).toContain('name="สรุปรายคน"');

  // ผู้ดูแลปลดล็อก
  await signOut(page);
  await loginAs(page, 'demo@itembank.local', false);
  await page.getByRole('link', { name: 'ผู้ดูแล O-NET' }).click();
  await expect(page.getByTestId('onet-admin-stats')).toContainText('ครูที่สมัคร (onet)');
  await page.getByLabel('ค้นหาครู').fill('onet@');
  await page.getByRole('button', { name: 'ค้นหา' }).click();
  const row = page.getByTestId('onet-admin-users').locator('tr[data-email="onet@itembank.local"]');
  await expect(row).toContainText('1/2');
  await row.getByLabel('หมายเหตุ onet@itembank.local').fill('สลิป 20 พ.ย.');
  await row.getByRole('button', { name: 'ปลดล็อก' }).click();
  await expect(row).toContainText('ปลดล็อกแล้ว · สลิป 20 พ.ย.');

  // ครูกลับมา: ชุด 3 ใช้ได้ สแกนได้
  await signOut(page);
  await loginAs(page, 'onet@itembank.local', false);
  await expect(page.getByTestId('set-S03')).toHaveAttribute('data-usable', 'true');
  await expect(page.getByTestId('lock-panel')).toHaveCount(0);
  await page.getByTestId('set-S03').click();
  await expect(page.getByTestId('set-actions')).toBeVisible();
  await page.getByRole('link', { name: 'ห้องของฉัน' }).click();
  await page.getByTestId('room').getByRole('link', { name: 'สแกน' }).click();
  await page.getByRole('button', { name: 'อัปโหลดภาพ/PDF' }).click();
  await page.getByTestId('onet-upload-input').setInputFiles(onetPhotoFile(3, marksFor(3, [0, 7], onetDemoKey(3))));
  await expect(page.getByTestId('onet-last')).toContainText('เลขที่ 7 · ชุดที่ 3 · 100 คะแนน', { timeout: 20_000 });
});
