import { test } from "node:test";
import { strict as assert } from "node:assert";
import { uninvoicedSubscriptionCost } from "../src/lib/subscriptionCost";

test("subscription costs are not counted twice when invoices are linked", () => {
  const subscription = { id: "shine", cost: 1000 };
  assert.equal(uninvoicedSubscriptionCost(subscription, []), 1000);
  assert.equal(uninvoicedSubscriptionCost(subscription, [{ subscriptionId: "shine", totalAmount: 400, paymentStatus: "Paid" }]), 600);
  assert.equal(uninvoicedSubscriptionCost(subscription, [{ subscriptionId: "shine", totalAmount: 1000, paymentStatus: "Paid" }]), 0);
  assert.equal(uninvoicedSubscriptionCost(subscription, [{ subscriptionId: "shine", totalAmount: 1000, paymentStatus: "Cancelled" }]), 1000);
  assert.equal(uninvoicedSubscriptionCost(subscription, [{ subscriptionId: "other", totalAmount: 1000, paymentStatus: "Paid" }]), 1000);
});
