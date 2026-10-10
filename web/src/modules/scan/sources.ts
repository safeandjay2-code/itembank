// แปลงไฟล์ที่ครูเลือก (ภาพถ่าย/ภาพสแกน/PDF หลายหน้า) เป็นภาพสำหรับเครื่องอ่าน — ทำในเครื่องนี้ทั้งหมด ไม่อัปโหลดไปไหน
export interface PageImage { label: string; image: ImageData }

/** ด้านยาวสุดของภาพที่ส่งให้เครื่องอ่าน (ภาพมือถือ 12 ล้านพิกเซลย่อลงให้เร็วขึ้น โดยยังละเอียดพอ) */
const MAX_DIM = 2800;
/** ความละเอียดตอนแปลงหน้า PDF (จุดต่อนิ้ว) */
const PDF_DPI = 200;

function canvasOf(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  return { c, ctx };
}

export function isPdf(f: File) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name); }

async function imageFile(f: File): Promise<PageImage[]> {
  const bmp = await createImageBitmap(f);   // หมุนตาม EXIF ของภาพมือถืออัตโนมัติ
  const s = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
  const { ctx } = canvasOf(w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return [{ label: f.name, image: ctx.getImageData(0, 0, w, h) }];
}

/** PDF: แปลงทีละหน้า (โหลดตัวอ่าน PDF เฉพาะเมื่อใช้) */
export async function* pdfPages(f: File): AsyncGenerator<PageImage> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      let vp = page.getViewport({ scale: PDF_DPI / 72 });
      const big = Math.max(vp.width, vp.height);
      if (big > MAX_DIM * 1.2) vp = page.getViewport({ scale: (PDF_DPI / 72) * (MAX_DIM * 1.2 / big) });
      const { c, ctx } = canvasOf(Math.round(vp.width), Math.round(vp.height));
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      yield { label: `${f.name} หน้า ${p}`, image: ctx.getImageData(0, 0, c.width, c.height) };
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
}

export async function* fileImages(f: File): AsyncGenerator<PageImage> {
  if (isPdf(f)) { yield* pdfPages(f); return; }
  for (const p of await imageFile(f)) yield p;
}

/** เฟรมจากวิดีโอกล้อง */
export function videoFrame(v: HTMLVideoElement, canvas: HTMLCanvasElement): ImageData | null {
  const w = v.videoWidth, h = v.videoHeight;
  if (!w || !h) return null;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(v, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}
