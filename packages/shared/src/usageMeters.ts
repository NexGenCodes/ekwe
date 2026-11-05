export const USAGE_METER_IDS = [
  "translate",
  "transcribe",
  "speech",
  "stream",
] as const;
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
    unit: "min",
    helper: "Audio transcribed today",
  },
  {
    id: "speech",
    label: "Speech",
    unit: "chars",
    helper: "Conversions today",
  },
  {
    id: "stream",
    label: "Live dictation",
    unit: "min",
    helper: "Live dictation this month",
  },
];
