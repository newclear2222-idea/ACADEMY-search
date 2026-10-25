// 원장일지 사이트에서 쓰던 계산기의 확인값과 대조합니다.
import { calculateProfile, type CalendarType, type GenderType } from "./lib/saju-profile";

const cases: [string, string, CalendarType, GenderType, { daeun?: number; pillars?: string[] }][] = [
  ["1995-03-11", "07:30", "양력", "남성", { daeun: 2 }],
  ["1995-03-11", "07:30", "양력", "여성", { daeun: 8 }],
  ["1995-03-16", "07:30", "양력", "남성", { pillars: ["을해", "기묘", "병오", "임진"], daeun: 3 }],
  ["1995-03-16", "07:30", "음력", "여성", { pillars: ["을해", "경진", "병자", "임진"], daeun: 7 }],
  ["2024-02-04", "16:00", "양력", "여성", { pillars: ["계묘", "을축"] }],
  ["2024-02-04", "19:00", "양력", "남성", { pillars: ["갑진", "병인"] }],
];
let fail = 0;
for (const [d, t, c, g, want] of cases) {
  const r = calculateProfile(d, t, c, g);
  const got = [r.chart.year, r.chart.month, r.chart.day, r.chart.hour].map((p) => p?.korean);
  const ok = (want.daeun === undefined || r.daeunStart === want.daeun) && (!want.pillars || want.pillars.every((p, i) => got[i] === p));
  if (!ok) fail += 1;
  console.log(ok ? "OK  " : "FAIL", d, t, c, g, got.join("·"), "대운", r.daeunStart, JSON.stringify(r.counts), JSON.stringify(r.sipseong));
}
process.exit(fail ? 1 : 0);
