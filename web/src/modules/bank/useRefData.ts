// โหลดข้อมูลอ้างอิงที่หน้าคลังใช้ร่วมกัน (ชั้น ตัวชี้วัด ระดับ ตั้งค่า) ครั้งเดียวต่อการเปิดเว็บ
import { useEffect, useState } from 'react';
import { repo } from '../../data';
import type { CognitiveLevel, DifficultyLevel, Grade, Indicator, Settings } from '../../core/types';

export interface RefData {
  grades: Grade[];
  indicators: Indicator[];
  difficulties: DifficultyLevel[];
  cognitives: CognitiveLevel[];
  settings: Settings;
  indicatorById: Map<string, Indicator>;
}

let cache: Promise<RefData> | null = null;

export function loadRefData(subjectId = 'MATH'): Promise<RefData> {
  if (!cache) {
    cache = Promise.all([repo.getGrades(), repo.getIndicators(subjectId), repo.getDifficultyLevels(),
      repo.getCognitiveLevels(), repo.getSettings()])
      .then(([grades, indicators, difficulties, cognitives, settings]) => ({
        grades, indicators, difficulties, cognitives, settings,
        indicatorById: new Map(indicators.map((i) => [i.id, i])),
      }))
      .catch((e) => { cache = null; throw e; });
  }
  return cache;
}

export function useRefData(): { data: RefData | null; error: string | null } {
  const [data, setData] = useState<RefData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { loadRefData().then(setData, (e) => setError((e as Error).message)); }, []);
  return { data, error };
}
