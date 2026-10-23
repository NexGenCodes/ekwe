export const USAGE_METER_IDS = [
  "translate",
  "transcribe",
  "speech",
  "stream",
  "budget",
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
    helper: "Text translated this month",
  },
  {
    id: "transcribe",
    label: "Transcription",
    unit: "min",
    helper: "Audio transcribed this month",
  },
  {
    id: "speech",
    label: "Speech",
    unit: "chars",
    helper: "Conversions this month",
  },
  {
    id: "stream",
    label: "Live dictation",
    unit: "min",
    helper: "Live dictation this month",
  },
  {
    id: "budget",
    label: "Shared AI budget",
    unit: "credits",
    helper: "Shared by translation, transcription, and speech",
  },
];
