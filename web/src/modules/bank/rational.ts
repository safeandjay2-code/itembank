// เลขเศษส่วนแบบแม่นยำ (BigInt) + ตัวแปลงนิพจน์ — ใช้คำนวณเฉลยซ้ำในการตรวจคุณภาพ (SPEC §5.6)
// ไม่ใช้ eval และไม่มีทศนิยมคลาดเคลื่อน เช่น 0.1 + 0.2 = 3/10 พอดี

export class Rational {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d: bigint = 1n) {
    if (d === 0n) throw new Error('หารด้วยศูนย์');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n < 0n ? -n : n, d);
    this.n = g ? n / g : n;
    this.d = g ? d / g : d;
  }
  static of(x: number | bigint | string): Rational {
    if (typeof x === 'bigint') return new Rational(x);
    const s = String(x).trim();
    const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m) throw new Error(`ตัวเลขไม่ถูกต้อง: ${s}`);
    const frac = m[3] ?? '';
    const n = BigInt(m[2] + frac) * (m[1] === '-' ? -1n : 1n);
    return new Rational(n, 10n ** BigInt(frac.length));
  }
  add(o: Rational) { return new Rational(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o: Rational) { return new Rational(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o: Rational) { return new Rational(this.n * o.n, this.d * o.d); }
  div(o: Rational) {
    if (o.n === 0n) throw new Error('หารด้วยศูนย์');
    return new Rational(this.n * o.d, this.d * o.n);
  }
  neg() { return new Rational(-this.n, this.d); }
  pow(e: Rational): Rational {
    if (e.d !== 1n) throw new Error('ยกกำลังได้เฉพาะเลขชี้กำลังจำนวนเต็ม');
    if (e.n < 0n) return new Rational(1n).div(this.pow(e.neg()));
    if (e.n > 64n) throw new Error('เลขชี้กำลังใหญ่เกินไป');
    return new Rational(this.n ** e.n, this.d ** e.n);
  }
  eq(o: Rational) { return this.n === o.n && this.d === o.d; }
  toNumber() { return Number(this.n) / Number(this.d); }
  /** แสดงผลแบบอ่านง่าย: จำนวนเต็ม, ทศนิยมจำกัด หรือเศษส่วน */
  toString(): string {
    if (this.d === 1n) return this.n.toString();
    let d = this.d, twos = 0, fives = 0;
    while (d % 2n === 0n) { d /= 2n; twos++; }
    while (d % 5n === 0n) { d /= 5n; fives++; }
    if (d === 1n) {
      const k = Math.max(twos, fives);
      const scaled = (this.n * 10n ** BigInt(k)) / this.d;
      const neg = scaled < 0n;
      const digits = (neg ? -scaled : scaled).toString().padStart(k + 1, '0');
      return `${neg ? '-' : ''}${digits.slice(0, -k)}.${digits.slice(-k)}`;
    }
    return `${this.n}/${this.d}`;
  }
}

function gcd(a: bigint, b: bigint): bigint {
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

// ---------- ตัวแปลงนิพจน์ ----------
// รองรับ: + - * / × ÷ ^ ( ) วงเล็บ, ทศนิยม, ตัวคั่นหลักพัน (1,250), ร้อยละ (25%)
type Tok = { t: 'num'; v: Rational } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s+/g, ' ');
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { i++; continue; }
    const m = /^\d[\d,]*(?:\.\d+)?/.exec(s.slice(i));
    if (m) {
      const raw = m[0];
      if (raw.includes(',') && !/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) throw new Error(`ตัวคั่นหลักพันไม่ถูกต้อง: ${raw}`);
      out.push({ t: 'num', v: Rational.of(raw.replace(/,/g, '')) });
      i += raw.length;
      continue;
    }
    if ('+-*/^()%'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`มีอักขระที่ไม่รู้จัก "${c}" ในนิพจน์`);
  }
  return out;
}

export function evaluate(src: string): Rational {
  if (!src.trim()) throw new Error('นิพจน์ว่าง');
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  function expr(): Rational {
    let v = term();
    while (isOp('+') || isOp('-')) { const op = toks[p++].v; const r = term(); v = op === '+' ? v.add(r) : v.sub(r); }
    return v;
  }
  function term(): Rational {
    let v = unary();
    while (isOp('*') || isOp('/')) { const op = toks[p++].v; const r = unary(); v = op === '*' ? v.mul(r) : v.div(r); }
    return v;
  }
  function unary(): Rational {
    if (isOp('-')) { p++; return unary().neg(); }
    if (isOp('+')) { p++; return unary(); }
    return power();
  }
  function power(): Rational {
    const b = postfix();
    if (isOp('^')) { p++; return b.pow(unary()); }
    return b;
  }
  function postfix(): Rational {
    let v = primary();
    while (isOp('%')) { p++; v = v.div(new Rational(100n)); }
    return v;
  }
  function primary(): Rational {
    const t = peek();
    if (!t) throw new Error('นิพจน์ไม่สมบูรณ์');
    if (t.t === 'num') { p++; return t.v; }
    if (t.v === '(') {
      p++;
      const v = expr();
      if (!isOp(')')) throw new Error('วงเล็บไม่ครบคู่');
      p++;
      return v;
    }
    throw new Error(`ไม่คาดว่าจะพบ "${t.v}"`);
  }
  const v = expr();
  if (p < toks.length) throw new Error(`ไม่คาดว่าจะพบ "${(toks[p] as any).v}"`);
  return v;
}

// ---------- อ่านค่าตัวเลขจากข้อความตัวเลือก ----------
// "3/4" "2 1/4" (จำนวนคละ) "1,250 บาท" "0.75" "25%" "-3" → ค่า; ถ้ามีตัวเลขหลายจำนวนหรือไม่มีเลย → null
const NUM_RE = /([-−]?)(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s+(\d+)\s*\/\s*(\d+)|\s*\/\s*(\d+))?(\s*%)?/g;

export function parseOptionValue(text: string): Rational | null {
  const s = text.trim();
  const matches = [...s.matchAll(NUM_RE)];
  if (matches.length !== 1) return null;
  const m = matches[0];
  const sign = m[1] ? -1n : 1n;
  let v = Rational.of(m[2].replace(/,/g, ''));
  try {
    if (m[3] && m[4]) v = v.add(Rational.of(m[3]).div(Rational.of(m[4])));
    else if (m[5]) v = v.div(Rational.of(m[5]));
  } catch { return null; }
  if (m[6]) v = v.div(new Rational(100n));
  return sign < 0n ? v.neg() : v;
}
