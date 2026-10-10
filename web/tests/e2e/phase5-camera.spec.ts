// ทดสอบเฟส 5: โหมดกล้อง — Chromium ใช้ไฟล์วิดีโอจำลองแทนกล้องจริง (ภาพกระดาษคำตอบที่ฝนแล้ว)
import { test, expect } from '@playwright/test';
import { answersInReview, createExam, FAKE_VIDEO, login, photo, sheetSvg, writeY4m } from './scanTools';

test.use({ launchOptions: {
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${FAKE_VIDEO}`],
} });

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await login(page);
});

test('ส่องกระดาษ → อ่านและบันทึกเอง แสดงคะแนนทันที · ถือค้างไว้ไม่บันทึกซ้ำ', async ({ page, context }) => {
  await context.grantPermissions(['camera']);
  const id = await createExam(page);
  const svg = await sheetSvg(page, id, 3);
  const shot = photo(svg, [[1, 2], [2, 4], [3, 1], [4, 2], [5, 3], [6, 1]], { rotate: 5, widthPx: 720 });
  writeY4m(FAKE_VIDEO, shot.rgba, shot.w, shot.h);
  await page.goto(`/#/exams/${id}/scan`);
  await page.getByTestId('camera-start').click();
  await expect(page.getByTestId('scan-last')).toContainText(/เลขที่ 3 · ชุด 3 · \d\/6/, { timeout: 20_000 });
  await expect(page.getByTestId('scan-progress')).toContainText('ตรวจแล้ว 1/7');
  // แผ่นเดิมยังอยู่หน้ากล้อง → ไม่บันทึกซ้ำ ไม่เตือนซ้ำ
  await page.waitForTimeout(2500);
  await expect(page.getByTestId('scan-last')).not.toContainText('สแกนซ้ำ');
  await page.getByRole('button', { name: 'ปิดกล้อง' }).click();
  await page.getByRole('button', { name: /ผลตรวจ/ }).click();
  await page.getByTestId('scan-table').getByRole('link').first().click();
  expect(await answersInReview(page)).toEqual(['2', '4', '1', '2', '3', '1']);
});
