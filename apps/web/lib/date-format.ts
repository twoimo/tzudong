/** Local-time Korean dates, matching the existing submission history labels. */
const dateOptions: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
};

export function formatKoreanDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", dateOptions).format(date);
}

export function formatKoreanDateTime(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    ...dateOptions,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
