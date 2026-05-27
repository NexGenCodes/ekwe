export interface PriceDetail {
  amount: number;      // Amount in standard units (e.g. 2.50 USD)
  currency: string;    // Currency code (e.g. NGN)
  lowestUnit: number;  // Amount in lowest denomination (e.g. 250 cents / 250000 kobo for NGN)
}

export interface PlanPricing {
  monthly: PriceDetail;
  annual: PriceDetail;
}

/**
 * Server-side trusted pricing table for Ekwe Pro plans.
 * This is the SINGLE source of truth for transactions to prevent client-side tampering.
 * Amounts are specified in standard units and converted to the lowest denomination
 * (e.g. cents, kobo, pesewas) as required by Paystack/Flutterwave APIs.
 */
export const PRICING_TABLE: Record<string, PlanPricing> = {
  USD: {
    monthly: { amount: 2.50, currency: 'USD', lowestUnit: 250 },
    annual: { amount: 24.00, currency: 'USD', lowestUnit: 2400 },
  },
  NGN: {
    monthly: { amount: 2500.00, currency: 'NGN', lowestUnit: 250000 },
    annual: { amount: 24000.00, currency: 'NGN', lowestUnit: 2400000 },
  },
  GBP: {
    monthly: { amount: 2.50, currency: 'GBP', lowestUnit: 250 },
    annual: { amount: 24.00, currency: 'GBP', lowestUnit: 2400 },
  },
  EUR: {
    monthly: { amount: 2.50, currency: 'EUR', lowestUnit: 250 },
    annual: { amount: 24.00, currency: 'EUR', lowestUnit: 2400 },
  },
  GHS: {
    monthly: { amount: 35.00, currency: 'GHS', lowestUnit: 3500 },
    annual: { amount: 340.00, currency: 'GHS', lowestUnit: 34000 },
  },
  KES: {
    monthly: { amount: 350.00, currency: 'KES', lowestUnit: 35000 },
    annual: { amount: 3400.00, currency: 'KES', lowestUnit: 340000 },
  },
  ZAR: {
    monthly: { amount: 45.00, currency: 'ZAR', lowestUnit: 4500 },
    annual: { amount: 440.00, currency: 'ZAR', lowestUnit: 44000 },
  },
  EGP: {
    monthly: { amount: 120.00, currency: 'EGP', lowestUnit: 12000 },
    annual: { amount: 1200.00, currency: 'EGP', lowestUnit: 120000 },
  },
  XOF: {
    monthly: { amount: 1500.00, currency: 'XOF', lowestUnit: 150000 },
    annual: { amount: 14000.00, currency: 'XOF', lowestUnit: 1400000 },
  },
  INR: {
    monthly: { amount: 200.00, currency: 'INR', lowestUnit: 20000 },
    annual: { amount: 2000.00, currency: 'INR', lowestUnit: 200000 },
  },
};
