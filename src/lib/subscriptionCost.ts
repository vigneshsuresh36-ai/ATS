/** Keep the uninvoiced portion of a subscription alongside its recorded invoices. */
export function uninvoicedSubscriptionCost(subscription: { id: string; cost: number }, invoices: { subscriptionId?: string; totalAmount: number; paymentStatus: string }[]): number {
  const invoiced = invoices.filter((invoice) => invoice.subscriptionId === subscription.id && invoice.paymentStatus !== "Cancelled").reduce((sum, invoice) => sum + Math.max(0, invoice.totalAmount || 0), 0);
  return Math.max(0, subscription.cost - invoiced);
}
