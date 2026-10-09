import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' ให้ใช้ได้ทั้งบน GitHub Pages (โฟลเดอร์ย่อย) และโฮสต์อื่น — ใช้ hash routing จึงไม่ต้องตั้งค่าเซิร์ฟเวอร์
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { fs: { allow: ['..'] } },
  test: { include: ['tests/unit/**/*.test.ts'] },
} as any);
