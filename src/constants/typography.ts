export const typography = {
  display: {
    fontFamily: "Outfit-Bold",
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  heading1: {
    fontFamily: "Outfit-Bold",
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
  heading2: {
    fontFamily: "Outfit-Bold",
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  heading3: {
    fontFamily: "Outfit-Bold",
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "600",
  },
  bodyLarge: {
    fontFamily: "Outfit-Regular",
    fontSize: 18,
    lineHeight: 27,
    fontWeight: "400",
  },
  body: {
    fontFamily: "Outfit-Regular",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400",
  },
  bodySmall: {
    fontFamily: "Outfit-Regular",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "400",
  },
  caption: {
    fontFamily: "Outfit-Regular",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "400",
  },
  label: {
    fontFamily: "Outfit-Medium",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
    letterSpacing: 0.5,
  },
  mono: {
    fontFamily: "SpaceMono-Regular",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400",
  },
} as const;

export type TypographyVariant = keyof typeof typography;
