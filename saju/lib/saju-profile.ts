import { lunarToSolar } from "@fullstackfamily/manseryeok";
import { SearchSunLongitude } from "astronomy-engine";
import { analyzeDaeun, analyzeElements, analyzeSipseong, deriveSaju, type Saju } from "k-saju";

export type SipseongCounts = {
  비겁: number;
  식상: number;
  재성: number;
  관성: number;
  인성: number;
};

export type ChartProfile = {
  chart: Saju;
  counts: Record<"木" | "火" | "土" | "金" | "水", number>;
  sipseong: SipseongCounts;
  daeunStart: number | null;
  daeunStartMonth: number | null;
};

export type CalendarType = "양력" | "음력";
export type GenderType = "여성" | "남성";

const elementCycle = ["木", "火", "土", "金", "水"] as const;
const YANG_STEMS = new Set(["甲", "丙", "戊", "庚", "壬"]);
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// 대운의 순행·역행을 가르는 12절(월 절입)과 태양 황경입니다.
const MONTH_BOUNDARY_TERMS = [
  { longitude: 285, month: 1, day: 5 },
  { longitude: 315, month: 2, day: 4 },
  { longitude: 345, month: 3, day: 5 },
  { longitude: 15, month: 4, day: 5 },
  { longitude: 45, month: 5, day: 5 },
  { longitude: 75, month: 6, day: 6 },
  { longitude: 105, month: 7, day: 7 },
  { longitude: 135, month: 8, day: 7 },
  { longitude: 165, month: 9, day: 7 },
  { longitude: 195, month: 10, day: 8 },
  { longitude: 225, month: 11, day: 7 },
  { longitude: 255, month: 12, day: 7 },
] as const;

function solarTermInstants(year: number) {
  return MONTH_BOUNDARY_TERMS.flatMap((term) => {
    const searchStart = new Date(Date.UTC(year, term.month - 1, term.day - 8));
    const result = SearchSunLongitude(term.longitude, searchStart, 20);
    return result ? [result.date.getTime()] : [];
  });
}

function exactDaeunAge(
  birthDate: string,
  birthTime: string,
  calendar: CalendarType,
  gender: GenderType,
  yearStem: string,
) {
  let [year, month, day] = birthDate.split("-").map(Number);
  if (calendar === "음력") {
    const solar = lunarToSolar(year, month, day, false).solar;
    year = solar.year;
    month = solar.month;
    day = solar.day;
  }

  const [hour, minute] = /^\d{2}:\d{2}$/.test(birthTime)
    ? birthTime.split(":").map(Number)
    : [12, 0];
  const birthUtcMs = Date.UTC(year, month - 1, day, hour, minute) - KST_OFFSET_MS;
  const terms = [
    ...solarTermInstants(year - 1),
    ...solarTermInstants(year),
    ...solarTermInstants(year + 1),
  ].sort((a, b) => a - b);

  const isYangYear = YANG_STEMS.has(yearStem);
  const forward = gender === "여성" ? !isYangYear : isYangYear;
  const governingTerm = forward
    ? terms.find((term) => term > birthUtcMs)
    : [...terms].reverse().find((term) => term <= birthUtcMs);

  if (governingTerm === undefined) return null;
  const exactDays = Math.abs(governingTerm - birthUtcMs) / DAY_MS;
  const exactYears = exactDays / 3;

  return {
    years: Math.max(1, Math.min(10, Math.round(exactYears))),
    months: Math.round((exactYears - Math.floor(exactYears)) * 12) % 12,
  };
}

export function calculateProfile(birthDate: string, birthTime: string, calendar: CalendarType, gender: GenderType): ChartProfile {
  const birth = {
    date: birthDate,
    ...(birthTime ? { time: birthTime } : {}),
    calendar: calendar === "양력" ? "solar" as const : "lunar" as const,
  };
  const chart = deriveSaju(birth);
  const elements = analyzeElements(chart);
  const sipseong = analyzeSipseong(chart);
  const daeun = analyzeDaeun(birth, chart, gender === "남성" ? "M" : "F");
  let exactDaeun: ReturnType<typeof exactDaeunAge> = null;
  try {
    exactDaeun = exactDaeunAge(birthDate, birthTime, calendar, gender, chart.year.stem);
  } catch {
    // 지원 범위 밖 음력 등은 기존 만세력 계산값으로 안전하게 대체합니다.
  }
  return {
    chart,
    counts: elements.counts,
    sipseong: sipseong.counts,
    daeunStart: exactDaeun?.years ?? daeun?.daeunsu ?? null,
    daeunStartMonth: exactDaeun?.months ?? null,
  };
}

export function dominantElement(profile: ChartProfile) {
  return elementCycle.reduce((best, current) => profile.counts[current] > profile.counts[best] ? current : best, elementCycle[0]);
}
