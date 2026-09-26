export const USAGE_METER_IDS = ["translate", "transcribe", "speech"] as const;
export type UsageMeterId = (typeof USAGE_METER_IDS)[number];

export interface UsageMeterMeta {
  id: UsageMeterId;

  label: string;

  unit: string;

  helper: string;
}

export const USAGE_METER_META: readonly UsageMeterMeta[] = [
  {
    id: "translate",
    label: "Translation",
    unit: "requests",
    helper: "Text translated today",
  },
  {
    id: "transcribe",
    label: "Transcription",
    unit: "requests",
    helper: "Audio transcribed today",
  },
  {
    id: "speech",
    label: "Speech",
    unit: "chars",
    helper: "Conversions today",
  },
];
