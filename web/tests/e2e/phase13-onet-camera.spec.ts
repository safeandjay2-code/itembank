// ห้อง O-NET เฟส 4: สแกนด้วยกล้อง — Chromium ใช้วิดีโอจำลอง (ภาพกระดาษ ON1 ที่ฝนแล้ว)
import { test, expect } from '@playwright/test';
import { FAKE_VIDEO, writeY4m } from './scanTools';
import { loadSheets, loginAs, marksFor, onetDemoKey, onetPhoto } from './onetTools';

const VIDEO = FAKE_VIDEO.replace('.y4m', '-onet.y4m');

test.use({ launchOptions: {
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${VIDEO}`],
} });

test.beforeEach(async ({ page }) => { page.on('pageerror', (e) => { throw e; }); });

test('ส่องกระดาษ O-NET → บันทึกเอง แสดงคะแนนทันที · ถือค้างไม่บันทึกซ้ำ', async ({ page, context }) => {
  await context.grantPermissions(['camera']);
  await loginAs(page, 'onet@itembank.local');
  await loadSheets(page);
  const shot = onetPhoto(2, marksFor(2, [1, 2], onetDemoKey(2)), { rotate: 3, widthPx: 1000 });
  writeY4m(VIDEO, shot.rgba, shot.w, shot.h);
  await page.getByTestId('go-rooms').click();
  await page.getByLabel('ชื่อห้องใหม่').fill('ห้องกล้อง');
  await page.getByTestId('room-create').click();
  await page.getByTestId('onet-camera-start').click();
  await expect(page.getByTestId('onet-last')).toContainText('เลขที่ 12 · ชุดที่ 2 · 100 คะแนน', { timeout: 30_000 });
  await page.waitForTimeout(2500);
  await expect(page.getByTestId('onet-ask')).toHaveCount(0);
  await expect(page.getByTestId('onet-scan-meta')).toContainText('บันทึกแล้ว 1 แผ่น');
});
