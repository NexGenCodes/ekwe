export const formatDuration = (
  audioDuration: number | undefined | null,
): string | null => {
  if (!audioDuration) return null;
  const mins = Math.floor(audioDuration / 60);
  const secs = Math.floor(audioDuration % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};
