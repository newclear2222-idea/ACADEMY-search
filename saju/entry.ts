// 사이트(app.js)에서 window.Saju로 씁니다. 계산은 lib/saju-profile.ts 그대로입니다.
import { lunarToSolar } from "@fullstackfamily/manseryeok";
import { analyzeDaeun, deriveSaju, JIJANGGAN, JIJANGGAN_TOTAL_DAYS, sipseongDetail, type Saju } from "k-saju";
import type { CalendarType, GenderType } from "./lib/saju-profile";

export { calculateProfile, dominantElement } from "./lib/saju-profile";

// 대운표의 간지는 k-saju에서 가져오고, 시작 나이는 보정된 daeunStart + 10 × 순번(0부터)으로 씁니다.
export function daeunTable(birthDate: string, birthTime: string, calendar: CalendarType, gender: GenderType, daeunStart: number) {
  const birth = {
    date: birthDate,
    ...(birthTime ? { time: birthTime } : {}),
    calendar: calendar === "양력" ? "solar" as const : "lunar" as const,
  };
  const chart = deriveSaju(birth);
  const daeun = analyzeDaeun(birth, chart, gender === "남성" ? "M" : "F");
  const principal = (branch: string) => {
    const hidden = (JIJANGGAN as Record<string, { stem: string }[]>)[branch] || [];
    return hidden[hidden.length - 1]?.stem || "";
  };
  return (daeun?.pillars || []).map((p, i) => ({
    startAge: daeunStart + 10 * i,
    ganji: p.ganji,
    stemElement: p.stemElement,
    branchElement: p.branchElement,
    // 지지의 십신은 정기(본기) 글자로 봅니다.
    stemGod: sipseongDetail(chart.day.stem, p.stem) || "",
    branchGod: sipseongDetail(chart.day.stem, principal(p.branch)) || "",
  }));
}

// 지금 나이를 셀 때 쓰는 양력 생일입니다(음력이면 양력으로 바꿉니다).
export function solarBirth(birthDate: string, calendar: CalendarType) {
  const [year, month, day] = birthDate.split("-").map(Number);
  if (calendar === "양력") return { year, month, day };
  const solar = lunarToSolar(year, month, day, false).solar;
  return { year: solar.year, month: solar.month, day: solar.day };
}

// 십신(정·편 구분)을 자리별 무게와 지장간 날수 비율로 셉니다. 해석 문구는 app.js에서 붙입니다.
const POS_WEIGHT: Record<string, number> = { 년간: 1, 년지: 1, 월간: 1, 월지: 2, 일지: 1.5, 시간: 1, 시지: 1 };
const PART_NAMES = ["여기", "중기", "정기"];
const CLASH = ["子午", "丑未", "寅申", "卯酉", "辰戌", "巳亥"];
export function tenGodProfile(chart: Saju) {
  const day = chart.day.stem;
  const pillars: [string, typeof chart.year | undefined][] = [["년", chart.year], ["월", chart.month], ["일", chart.day], ["시", chart.hour]];
  const items: { pos: string; char: string; god: string; w: number; part?: string; branch?: string }[] = [];
  const stems: { pos: string; char: string }[] = [];
  const branches: { pos: string; char: string }[] = [];
  for (const [p, pillar] of pillars) {
    if (!pillar) continue;
    if (p !== "일") {
      stems.push({ pos: `${p}간`, char: pillar.stem });
      items.push({ pos: `${p}간`, char: pillar.stem, god: sipseongDetail(day, pillar.stem) || "", w: POS_WEIGHT[`${p}간`] });
    }
    branches.push({ pos: `${p}지`, char: pillar.branch });
    const hidden = (JIJANGGAN as Record<string, { stem: string; days: number }[]>)[pillar.branch] || [];
    hidden.forEach((h, i) => {
      const part = PART_NAMES[hidden.length === 2 ? i + 1 : i];
      items.push({ pos: `${p}지`, char: h.stem, branch: pillar.branch, part, god: sipseongDetail(day, h.stem) || "", w: POS_WEIGHT[`${p}지`] * h.days / JIJANGGAN_TOTAL_DAYS });
    });
  }
  const scores: Record<string, number> = {};
  for (const it of items) scores[it.god] = (scores[it.god] || 0) + it.w;
  // 투출: 천간에 뜬 글자가 지지 속(지장간)에도 있으면 뿌리가 있다고 봅니다.
  const rooted = stems.filter((s) => items.some((it) => it.branch && it.char === s.char)).map((s) => ({ ...s, god: sipseongDetail(day, s.char) || "" }));
  // 격국: 월지 지장간 중 천간에 뜬 것(정기 → 중기 → 여기 순), 없으면 월지 정기.
  const monthHidden = items.filter((it) => it.pos === "월지").reverse();
  const shown = monthHidden.find((it) => stems.some((s) => s.char === it.char));
  const gyeok = shown || monthHidden[0];
  const clashes = [];
  for (let i = 0; i < branches.length; i += 1) for (let j = i + 1; j < branches.length; j += 1) {
    const pair = branches[i].char + branches[j].char;
    if (CLASH.some((c) => c === pair || c === pair[1] + pair[0])) clashes.push({ a: branches[i].pos, b: branches[j].pos, pair });
  }
  return { items, scores, rooted, gyeok: { god: gyeok.god, char: gyeok.char, part: gyeok.part, shown: Boolean(shown) }, clashes };
}
