import { describe, expect, it } from "vitest";
import { getCustomerOrderDisplayStatus } from "@/lib/customer-order-status";

const item = (quantity = 1) => ({ quantity });
const delivery = (status: string) => ({ status });

describe("customer order display status", () => {
  it("maps unpaid orders to waiting payment", () => {
    expect(getCustomerOrderDisplayStatus({ status: "PENDING", payment: { status: "PENDING" }, items: [item()] })).toBe("WAITING_PAYMENT");
  });
  it("keeps paid orders with pending delivery in processing", () => {
    expect(getCustomerOrderDisplayStatus({ status: "PAID", payment: { status: "PAID" }, items: [item()], deliveries: [delivery("PENDING")] })).toBe("PROCESSING");
  });
  it("uses the paid order status when a legacy order has no payment relation", () => {
    expect(getCustomerOrderDisplayStatus({ status: "PAID", items: [item()], deliveries: [delivery("PENDING")] })).toBe("PROCESSING");
  });
  it("keeps manual delivery in processing", () => {
    expect(getCustomerOrderDisplayStatus({ status: "PAID", payment: { status: "PAID" }, items: [item()], deliveries: [delivery("WAITING_MANUAL_DELIVERY")] })).toBe("PROCESSING");
  });
  it("shows awaiting confirmation after a seller sends manual delivery", () => {
    expect(getCustomerOrderDisplayStatus({ status: "PAID", payment: { status: "PAID" }, items: [item()], deliveries: [delivery("AWAITING_CONFIRMATION")] })).toBe("WAITING_CONFIRMATION");
  });
  it("completes when every delivery is delivered", () => {
    expect(getCustomerOrderDisplayStatus({ status: "PAID", payment: { status: "PAID" }, items: [item(2)], deliveries: [delivery("DELIVERED"), delivery("DELIVERED")] })).toBe("COMPLETED");
  });
  it("keeps a multi-seller order in progress until every seller item is delivered", () => {
    const order = { status: "PAID", payment: { status: "PAID" }, items: [item(), item()] };
    expect(getCustomerOrderDisplayStatus({ ...order, deliveries: [delivery("DELIVERED"), delivery("WAITING_MANUAL_DELIVERY")] })).toBe("PROCESSING");
    expect(getCustomerOrderDisplayStatus({ ...order, deliveries: [delivery("DELIVERED"), delivery("DELIVERED")] })).toBe("COMPLETED");
  });
  it("keeps partially delivered multi-item orders in processing", () => {
    expect(getCustomerOrderDisplayStatus({ status: "PAID", payment: { status: "PAID" }, items: [item(), item()], deliveries: [delivery("DELIVERED"), delivery("PENDING")] })).toBe("PROCESSING");
  });
  it("does not treat cancelled orders as completed", () => {
    expect(getCustomerOrderDisplayStatus({ status: "CANCELLED", payment: { status: "CANCELLED" }, items: [item()], deliveries: [delivery("DELIVERED")] })).toBe("CANCELLED");
  });
});
