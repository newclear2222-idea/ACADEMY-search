// 사이트(app.js)에서 window.Saju로 씁니다. 계산은 lib/saju-profile.ts 그대로입니다.
import { lunarToSolar } from "@fullstackfamily/manseryeok";
import { analyzeDaeun, deriveSaju } from "k-saju";
import type { CalendarType, GenderType } from "./lib/saju-profile";

export { calculateProfile, dominantElement } from "./lib/saju-profile";

// 대운표의 간지는 k-saju에서 가져오고, 시작 나이는 보정된 daeunStart + 10 × 순번(0부터)으로 씁니다.
export function daeunTable(birthDate: string, birthTime: string, calendar: CalendarType, gender: GenderType, daeunStart: number) {
  const birth = {
    date: birthDate,
    ...(birthTime ? { time: birthTime } : {}),
    calendar: calendar === "양력" ? "solar" as const : "lunar" as const,
  };
  const daeun = analyzeDaeun(birth, deriveSaju(birth), gender === "남성" ? "M" : "F");
  return (daeun?.pillars || []).map((p, i) => ({
    startAge: daeunStart + 10 * i,
    ganji: p.ganji,
    stemElement: p.stemElement,
    branchElement: p.branchElement,
  }));
}

// 지금 나이를 셀 때 쓰는 양력 생일입니다(음력이면 양력으로 바꿉니다).
export function solarBirth(birthDate: string, calendar: CalendarType) {
  const [year, month, day] = birthDate.split("-").map(Number);
  if (calendar === "양력") return { year, month, day };
  const solar = lunarToSolar(year, month, day, false).solar;
  return { year: solar.year, month: solar.month, day: solar.day };
}
