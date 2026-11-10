const numberFmt = new Intl.NumberFormat("en-US");

export function fmtNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return numberFmt.format(value);
}

export function fmtPercent(value: number, maximumFractionDigits = 0): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits,
  }).format(value);
}

export function fmtCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function fmtDateTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtRelative(ms: number | null | undefined): string {
  if (!ms) return "—";
  const delta = Date.now() - ms;
  if (Number.isNaN(delta)) return "—";
  const future = delta < 0;
  const elapsed = Math.abs(delta);
  const suffix = (value: string) => (future ? `in ${value}` : `${value} ago`);

  if (elapsed < 45_000) return future ? "in a moment" : "just now";
  const minutes = Math.round(elapsed / 60_000);
  if (minutes < 60) return suffix(`${minutes}m`);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return suffix(`${hours}h`);
  const days = Math.round(hours / 24);
  if (days < 7) return suffix(`${days}d`);
  return fmtDate(ms);
}

export function fmtTimeLeft(ms: number | null | undefined): string {
  if (!ms) return "—";
  const diff = ms - Date.now();
  if (Number.isNaN(diff)) return "—";
  if (diff <= 0) return "Expired";
  const hours = Math.ceil(diff / 3_600_000);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(diff / 86_400_000);
  if (days < 60) return `in ${days}d`;
  const months = Math.round(days / 30);
  return `in ${months} months`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function fmtBytes(value: number | null | undefined): string {
  if (!value || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function fmtCurrency(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (amount === null || amount === undefined) return "—";
  const code = (currency ?? "").toUpperCase();
  if (!code) return fmtNumber(amount);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${code} ${fmtNumber(amount)}`;
  }
}

export function shortId(id: string | null | undefined, length = 8): string {
  if (!id) return "—";
  return id.length <= length ? id : `${id.slice(0, length)}…`;
}
