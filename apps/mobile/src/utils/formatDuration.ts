const toClock = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(mins)}:${pad(secs)}`
    : `${mins}:${pad(secs)}`;
};

export const formatDuration = (
  audioDuration: number | undefined | null,
): string | null => {
  if (!audioDuration) return null;
  return toClock(audioDuration);
};

export const formatClock = (seconds: number | undefined | null): string => {
  if (!seconds || seconds < 0) return "0:00";
  return toClock(seconds);
};
