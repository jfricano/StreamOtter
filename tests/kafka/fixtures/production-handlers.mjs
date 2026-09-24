// Minimal compiled-JavaScript handler module for the production CLI test.
const orders = new Map([["acme/ord_1", { revision: "1", data: { orderId: "ord_1", status: "queued", progress: 0 } }]]);
export const handlers = {
  authenticate: ({ token }) => token === "alice-token"
    ? { subject: "alice", tenantId: "acme", sessionId: "s1", expiresAt: "2099-01-01T00:00:00.000Z", claims: {} }
    : null,
  channels: {
    orderStatus: {
      authorize: ({ principal, params }) => orders.has(`${principal.tenantId}/${params.orderId}`),
      map: ({ record }) => [{ tenantId: record.value.tenantId, params: { orderId: record.value.order.orderId }, revision: record.value.revision, data: record.value.order }],
      snapshot: ({ principal, params }) => orders.get(`${principal.tenantId}/${params.orderId}`)
    }
  }
};
// Exported but ignored by `streamotter start`.
export const development = { principals: {}, fixtures: {} };
