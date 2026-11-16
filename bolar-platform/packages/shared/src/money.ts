/** All money is integer cents. */
export type Cents = number;
export function assertCents(v: number, field = 'amountCents'): void {
  if (!Number.isInteger(v)) throw new Error(`${field} must be integer cents`);
}
export function formatCents(cents: Cents, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
