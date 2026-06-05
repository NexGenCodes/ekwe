export { EkweError, ErrorMessages } from './errors';
export { LANGUAGES, getLanguageName } from './languages';
export type { Language } from './languages';
export { LEGAL_DOCUMENTS } from './legal';
export type { LegalDocument, LegalSection } from './legal';
export { BILLING_PLANS, PLAN_LIMITS, DISPLAY_PRICING } from './billing';
export type { PlanFeature, FallbackPrice } from './billing';

// Design tokens
export { spacing } from './spacing';
export type { SpacingKey } from './spacing';
export { typography } from './typography';
export type { TypographyVariant } from './typography';
export { borderRadius, iconSize, touchTarget, opacity, zIndex } from './sizes';
export type {
  BorderRadiusKey,
  IconSizeKey,
  TouchTargetKey,
  OpacityKey,
  ZIndexKey,
} from './sizes';
export { shadows } from './shadows';
export type { ShadowKey } from './shadows';
export { duration, spring, scale } from './motion';
export type { DurationKey, SpringKey } from './motion';
export { CONTACT_EMAIL } from './contact';
export { palette, lightColors, darkColors, getTheme } from './colors';
export type { ColorsKey } from './colors';
export { SUPPORTED_CURRENCIES, DEFAULT_CURRENCY, detectDeviceCurrency, formatCurrency } from './currency';
export type { CurrencyConfig } from './currency';
