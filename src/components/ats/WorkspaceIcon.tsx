import type { CSSProperties } from "react";
const paths: Record<string, string> = {
  home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Zm6 11v-7h6v7",
  document: "M14 2H5a1 1 0 0 0-1 1v18a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8Zm0 0v6h6M8 12h8M8 16h6",
  fileCheck: "M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5Zm0 0v5h5m-10 5 2 2 4-4",
  calendar: "M4 5h16v16H4ZM8 2v6m8-6v6M4 10h16",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2",
  check: "M9 12l2 2 4-5M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  briefcase: "M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-10 0h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z",
  people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M13 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  users: "M16 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1m13 0v-1a4 4 0 0 1 3-3.87M13 5a4 4 0 1 1-8 0 4 4 0 0 1 8 0m7 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z",
  sparkle: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4",
  bolt: "m13 2-9 12h7l-1 8 10-13h-8Z",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m-9 4h2m14 0h2M12 3v2m0 14v2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4",
  sliders: "M4 7h11m4 0h1M4 17h1m4 0h11M8 4v6m8 10v-6m-8 0v6m-4-6h8m8 0h4m-8 0V4m0 8v8",
  chart: "M4 21V10m7 11V3m7 18v-7M2 21h20",
  barChart: "M4 20V8m6 12V4m6 16v-8m4 8V2M2 20h20",
  search: "M21 21l-6-6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm-3-13a3 3 0 1 1 5 2.25c-1 .8-2 1.25-2 2.75m0 3h.01",
  mail: "M3 5h18v14H3Zm0 0 9 8 9-8",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  close: "m6 6 12 12M6 18 18 6",
  shield: "M12 3 5 6v7c0 5 3.5 8.5 7 10 3.5-1.5 7-5 7-10V6l-7-3Zm-3 9 2 2 4-4",
  lifebuoy: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-3.54-.46-2.12-2.12m11.32 11.32 2.12 2.12m0-11.32-2.12 2.12M8.46 15.54l-2.12 2.12",
  wallet: "M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm0 0h16v4H15a2 2 0 0 0-2 2v.5a.5.5 0 0 1-.5.5h-5A1.5 1.5 0 0 1 6 15.5V14a2 2 0 0 1 2-2h8",
};
export function WorkspaceIcon({ name, size = 20, style }: { name: string; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name] || paths.document} /></svg>;
}
