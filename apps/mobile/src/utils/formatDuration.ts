export const formatDuration = (
  audioDuration: number | undefined | null,
): string | null => {
  if (!audioDuration) return null;
  const rounded = Math.round(audioDuration);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};
