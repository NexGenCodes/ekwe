export function mimeToExt(mime: string): string {
  if (mime === 'audio/ogg') return 'ogg';
  return 'wav';
}
