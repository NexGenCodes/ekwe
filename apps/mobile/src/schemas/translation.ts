import { z } from "zod";

export const translationSchema = z
  .object({
    text: z.string().min(1, "Please enter text to translate."),
    sourceLang: z
      .string()
      .min(1, "Please select a source language.")
      .refine((val) => val !== "none" && val !== "", {
        message: "Please select a source language.",
      }),
    targetLang: z
      .string()
      .min(1, "Please select a target language.")
      .refine((val) => val !== "none" && val !== "", {
        message: "Please select a target language.",
      }),
  })
  .refine(
    (data) => data.sourceLang === "auto" || data.sourceLang !== data.targetLang,
    {
      message: "Source and target languages cannot be the same.",
      path: ["targetLang"],
    },
  );

export type TranslationInput = z.infer<typeof translationSchema>;
