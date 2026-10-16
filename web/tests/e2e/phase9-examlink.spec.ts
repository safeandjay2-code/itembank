// ทดสอบ One Stop เฟส 3: สร้างชุดข้อสอบผูกห้อง + ประเภทการสอบ (โหมดสาธิต)
//   จากหน้าห้อง → สร้างชุดเก็บคะแนน (ชั้น/จำนวนนักเรียนตามห้อง) · กติกาห้อง/เลขที่ · สอบซ่อม · เปลี่ยนประเภทในหน้าชุด · ป้ายในรายการ
import { test, expect, type Page } from '@playwright/test';
import { IND1, IND2, login, setRow } from './scanTools';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await login(page);
});

/** ห้อง ป.4/1 นักเรียน 7 คน ไม่เลือกตัวชี้วัด (เพิ่มทีหลัง) */
async function createRoom(page: Page) {
  await page.goto('/#/classes/new');
  await page.getByRole('group', { name: 'เลือกชั้น' }).getByRole('button', { name: 'ป.4' }).click();
  await expect(page.getByLabel('ชื่อห้อง')).toHaveValue('ป.4/1');
  await page.getByLabel('จำนวนนักเรียน (เลขที่ 1–N)').fill('7');
  await page.getByRole('button', { name: 'สร้างห้องเรียน' }).click();
  await expect(page.getByTestId('class-title')).toContainText('ป.4/1');
}

/** ขั้น 1–3: 6 ข้อ 3 ชุด (ชั้นตามที่เลือกไว้แล้ว) */
async function fillItems(page: Page) {
  await page.getByLabel('จำนวนข้อ', { exact: true }).fill('6');
  await page.getByLabel('จำนวนชุด (กันลอก)').fill('3');
  await setRow(page, 1, IND1, 'ง่าย', 2);
  await page.getByRole('button', { name: '+ เพิ่มแถว' }).click();
  await setRow(page, 2, IND1, 'ปานกลาง', 2);
  await page.getByRole('button', { name: '+ เพิ่มแถว' }).click();
  await setRow(page, 3, IND2, 'ยาก', 2);
}

test('สร้างชุดเก็บคะแนนจากหน้าห้อง: ล็อกชั้น + จำนวนนักเรียนครบห้อง + เตือนตัวชี้วัดที่ยังไม่มีช่อง', async ({ page }) => {
  await createRoom(page);
  await expect(page.getByTestId('room-exams')).toContainText('ชุดข้อสอบของห้องนี้ (0)');
  await page.getByTestId('room-new-exam').click();

  await expect(page.getByRole('heading', { name: 'สร้างชุดข้อสอบ' })).toBeVisible();
  const purpose = page.getByRole('group', { name: 'ประเภทการสอบ' });
  await expect(purpose.getByRole('button', { name: 'เก็บคะแนน' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('ห้องเรียน', { exact: true })).toHaveValue('class-1');
  await expect(page.getByRole('button', { name: 'ป.4', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'ป.5', exact: true })).toBeDisabled();
  await expect(page.getByLabel('จำนวนนักเรียน (เลขที่ 1–N)')).toHaveValue('7');
  await expect(page.getByLabel('ชื่อแบบทดสอบ')).toHaveValue('แบบทดสอบ คณิตศาสตร์ ป.4/1');

  await fillItems(page);
  await expect(page.getByTestId('unplanned')).toContainText(`ตัวชี้วัด ${IND1}, ${IND2} ยังไม่มีช่องในห้อง ป.4/1`);
  // เลขที่ไม่ครบห้อง → สร้างไม่ได้
  await page.getByLabel('จำนวนนักเรียน (เลขที่ 1–N)').fill('6');
  await expect(page.getByTestId('link-errors')).toContainText('ห้อง ป.4/1 มีนักเรียน 7 คน แต่ชุดข้อสอบมีเลขที่ถึง 6');
  await expect(page.getByRole('button', { name: 'สร้างข้อสอบ' })).toBeDisabled();
  await page.getByLabel('จำนวนนักเรียน (เลขที่ 1–N)').fill('7');
  await expect(page.getByTestId('link-errors')).toHaveCount(0);
  await page.getByRole('button', { name: 'สร้างข้อสอบ' }).click();

  await expect(page.getByTestId('exam-meta')).toBeVisible();
  await expect(page.getByTestId('exam-link-label')).toHaveText('เก็บคะแนน · ป.4/1');
  await expect(page.getByTestId('exam-link-card')).toContainText('ผลตรวจทุกแผ่นลงสมุดคะแนนของห้อง ป.4/1 อัตโนมัติ');
  await expect(page.getByTestId('exam-expiry')).toHaveCount(0);

  // รายการชุด + หน้าห้อง
  await page.goto('/#/exams');
  await expect(page.getByTestId('exam-link').first()).toHaveText('เก็บคะแนน · ป.4/1');
  await page.goto('/#/classes/class-1');
  await expect(page.getByTestId('room-exams')).toContainText('ชุดข้อสอบของห้องนี้ (1)');
  await expect(page.getByTestId('room-exams')).toContainText('แบบทดสอบ คณิตศาสตร์ ป.4/1');
});

test('เลือกประเภทเอง: ฝึกไม่ต้องมีห้อง · เก็บคะแนนต้องเลือกห้อง · สอบซ่อมเลขที่ไม่ต้องครบ', async ({ page }) => {
  // ยังไม่มีห้อง → เก็บคะแนนสร้างไม่ได้ ต้องสร้างห้องก่อน
  await page.goto('/#/exams/new');
  const purpose = page.getByRole('group', { name: 'ประเภทการสอบ' });
  await expect(purpose.getByRole('button', { name: 'ฝึก/วินิจฉัย' })).toHaveAttribute('aria-pressed', 'true');
  await purpose.getByRole('button', { name: 'เก็บคะแนน' }).click();
  await expect(page.getByTestId('no-classrooms')).toBeVisible();

  await createRoom(page);
  await page.goto('/#/exams/new');
  await purpose.getByRole('button', { name: 'ปลายภาค' }).click();
  await expect(page.getByLabel('ห้องเรียน', { exact: true })).toHaveValue('class-1');   // ห้องเดียว เลือกให้เลย
  await expect(page.getByLabel('ชื่อแบบทดสอบ')).toHaveValue('แบบทดสอบปลายภาค คณิตศาสตร์ ป.4/1');
  await page.getByLabel('ห้องเรียน', { exact: true }).selectOption('');
  await fillItems(page);
  await expect(page.getByTestId('link-errors')).toContainText('ชุดเก็บคะแนน/ปลายภาคต้องเลือกห้องเรียน');
  await expect(page.getByRole('button', { name: 'สร้างข้อสอบ' })).toBeDisabled();
  await page.getByLabel('ห้องเรียน', { exact: true }).selectOption('class-1');
  await page.getByRole('button', { name: 'สร้างข้อสอบ' }).click();
  await expect(page.getByTestId('exam-link-label')).toHaveText('ปลายภาค · ป.4/1');
  const rootUrl = page.url();

  // สอบซ่อมของชุดปลายภาค: เลขที่ 3 คนพอ
  await page.goto('/#/exams/new?classroom=class-1');
  await purpose.getByRole('button', { name: 'ปลายภาค' }).click();
  await page.getByLabel('สอบซ่อม/สอบซ้ำ').selectOption({ label: 'สอบซ่อมของ: แบบทดสอบปลายภาค คณิตศาสตร์ ป.4/1' });
  await expect(page.getByLabel('ชื่อแบบทดสอบ')).toHaveValue('สอบซ่อมปลายภาค คณิตศาสตร์ ป.4/1');
  await fillItems(page);
  await page.getByLabel('จำนวนนักเรียน (เลขที่ 1–N)').fill('3');
  await expect(page.getByTestId('link-errors')).toHaveCount(0);
  await page.getByRole('button', { name: 'สร้างข้อสอบ' }).click();
  await expect(page.getByTestId('exam-link-label')).toContainText('สอบซ่อม (ปลายภาค) · ป.4/1 — สอบซ่อมของ "แบบทดสอบปลายภาค คณิตศาสตร์ ป.4/1"');

  // ชุดฝึกแบบเดิม ไม่ต้องมีห้อง
  await page.goto('/#/exams/new');
  await page.getByRole('button', { name: 'ป.4', exact: true }).click();
  await fillItems(page);
  await page.getByLabel('จำนวนนักเรียน (เลขที่ 1–N)').fill('5');
  await page.getByRole('button', { name: 'สร้างข้อสอบ' }).click();
  await expect(page.getByTestId('exam-link-label')).toHaveText('ฝึก/วินิจฉัย');
  await expect(page.getByTestId('exam-link-card')).toContainText('ไม่นับคะแนน');

  // ชุดแรกที่มีสอบซ่อมผูกอยู่ ลบได้ (ยังไม่มีคะแนน) → ไม่มีคำเตือนคะแนนหาย
  await page.goto(rootUrl);
  await page.getByRole('button', { name: 'ลบชุดข้อสอบนี้…' }).click();
  await expect(page.getByTestId('delete-scores-warning')).toHaveCount(0);
});

test('เปลี่ยนห้อง/ประเภทการสอบในหน้าชุดก่อนมีผลตรวจ', async ({ page }) => {
  await createRoom(page);
  await page.goto('/#/exams/new');
  await page.getByRole('button', { name: 'ป.4', exact: true }).click();
  await fillItems(page);
  await page.getByLabel('จำนวนนักเรียน (เลขที่ 1–N)').fill('5');
  await page.getByRole('button', { name: 'สร้างข้อสอบ' }).click();
  await expect(page.getByTestId('exam-link-label')).toHaveText('ฝึก/วินิจฉัย');

  await page.getByTestId('relink').click();
  const card = page.getByTestId('exam-link-card');
  await card.getByRole('button', { name: 'เก็บคะแนน' }).click();
  // ชุดนี้มีเลขที่ 5 แต่ห้องมี 7 คน → บันทึกไม่ได้
  await expect(card).toContainText('ห้อง ป.4/1 มีนักเรียน 7 คน แต่ชุดข้อสอบมีเลขที่ถึง 5');
  await expect(card.getByRole('button', { name: 'บันทึก' })).toBeDisabled();
  await card.getByRole('button', { name: 'ฝึก/วินิจฉัย' }).click();
  await card.getByRole('button', { name: 'บันทึก' }).click();
  await expect(page.getByTestId('link-msg')).toHaveText('บันทึกห้อง/ประเภทการสอบแล้ว');
  await expect(page.getByTestId('exam-link-label')).toHaveText('ฝึก/วินิจฉัย');
});
