export function candidateSourceLabel(source?: string) {
  return source === "Walk-in" ? "Direct / Inbound" : source;
}