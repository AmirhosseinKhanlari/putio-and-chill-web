export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function runtime(minutes?: number | null): string | undefined {
  if (!minutes || minutes <= 0) return undefined;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Time left to watch: "7m left", "1h 5m left", "Almost done". */
export function left(seconds: number): string {
  return seconds < 60 ? "Almost done" : `${runtime(Math.floor(seconds / 60))} left`;
}

export function bytes(count?: number | null): string {
  if (count === undefined || count === null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = count, unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++; }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "")} ${units[unit]}`;
}

export function speed(bytesPerSecond?: number | null): string | undefined {
  return bytesPerSecond ? `${bytes(bytesPerSecond)}/s` : undefined;
}

export function episodeCode(season?: number, episode?: number): string {
  if (season === undefined) return "";
  return `S${season}${episode !== undefined ? ` E${episode}` : ""}`;
}
