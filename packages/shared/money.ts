import { CURRENCY_BY_CODE, getCurrency } from "./currencies";

export function getDecimals(code: string): number {
  return CURRENCY_BY_CODE.get(code.toUpperCase())?.decimals ?? 2;
}

export function roundToCurrency(amount: number, code: string): number {
  const d = getDecimals(code);
  return Math.round(amount * 10 ** d) / 10 ** d;
}

export function toLowestUnit(amount: number, code: string): number {
  return Math.round(amount * 10 ** getDecimals(code));
}

export function computeSavingPercent(
  monthlyAmount: number,
  annualAmount: number,
): number {
  return Math.round((1 - annualAmount / (monthlyAmount * 12)) * 100);
}

export function formatMoney(amount: number, code: string): string {
  const config = getCurrency(code);
  const symbol = config?.symbol ?? "$";
  return `${symbol}${amount.toLocaleString(undefined, {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
