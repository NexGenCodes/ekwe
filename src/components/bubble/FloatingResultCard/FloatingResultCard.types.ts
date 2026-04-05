export interface FloatingResultCardProps {
  transcript: string;
  sourceLang: string;
  targetLang: string | null;
  duration: number;
  sessionId: string;
  onDismiss: () => void;
}
