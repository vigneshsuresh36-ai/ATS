export type HoneyBadgerMood = "smile" | "sad";

const MOOD_EVENT = "ats:honeybadger-mood";

export function signalHoneyBadgerMood(mood: HoneyBadgerMood) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MOOD_EVENT, { detail: mood }));
  }
}

export function honeyBadgerMoodEventName() {
  return MOOD_EVENT;
}