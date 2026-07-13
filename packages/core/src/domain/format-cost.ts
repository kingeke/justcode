/**
 * Formats a USD cost for display: two decimals once the amount reaches $1
 * (e.g. "3.51"), four decimals below that so tiny per-request costs stay
 * visible (e.g. "0.0071"). Callers prepend the currency symbol.
 */
export function formatCost(cost: number): string {
  return cost >= 1 ? cost.toFixed(2) : cost.toFixed(4);
}
