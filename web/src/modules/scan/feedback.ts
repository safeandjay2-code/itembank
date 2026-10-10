// เสียง/สั่นเมื่ออ่านสำเร็จหรือมีเรื่องต้องดู (SPEC §8.1) — ไม่ใช้ไฟล์เสียง สร้างเสียงด้วย Web Audio
let ctx: AudioContext | null = null;

/** ต้องเรียกจากการกดปุ่มของผู้ใช้ครั้งแรก (นโยบายเบราว์เซอร์) */
export function unlockAudio() {
  try {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!ctx && AC) ctx = new AC();
    ctx?.resume?.();
  } catch { ctx = null; }
}

function tone(freq: number, startMs: number, durMs: number, vol = 0.18) {
  if (!ctx) return;
  const t = ctx.currentTime + startMs / 1000;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = freq;
  o.type = 'sine';
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.linearRampToValueAtTime(0, t + durMs / 1000);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + durMs / 1000 + 0.02);
}

export type FeedbackKind = 'ok' | 'remark' | 'warn';

export function feedback(kind: FeedbackKind) {
  try {
    if (kind === 'ok') { tone(1046, 0, 110); navigator.vibrate?.(60); }
    else if (kind === 'remark') { tone(1046, 0, 90); tone(784, 120, 140); navigator.vibrate?.([60, 60, 60]); }
    else { tone(330, 0, 160, 0.22); tone(330, 230, 160, 0.22); navigator.vibrate?.([150, 80, 150]); }
  } catch { /* อุปกรณ์ไม่รองรับ — ข้าม */ }
}
