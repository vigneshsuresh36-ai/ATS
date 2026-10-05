type DateValue = string | number | Date | null | undefined;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function parseDate(value: DateValue): Date | null {
  if (value === null || value === undefined || value === "") return null;

  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    date = new Date(year, month - 1, day, 12);
  } else {
    date = new Date(value);
  }

  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: DateValue, fallback = "-") {
  const date = parseDate(value);
  if (!date) return fallback;

  const day = String(date.getDate()).padStart(2, "0");
  return `${day}-${MONTHS[date.getMonth()]}-${date.getFullYear()}`;
}

export function formatDateTime(value: DateValue, fallback = "-") {
  const date = parseDate(value);
  if (!date) return fallback;

  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${formatDate(date)} ${time}`;
}