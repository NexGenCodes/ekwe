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
    label: "Translations",
    unit: "requests",
    helper: "Text translated today",
  },
  {
    id: "transcribe",
    label: "Transcriptions",
    unit: "requests",
    helper: "Audio transcribed today",
  },
  {
    id: "speech",
    label: "Voice conversions",
    unit: "conversions",
    helper: "Conversions today",
  },
];
