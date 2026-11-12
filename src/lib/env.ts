export const env = {
  paypalBaseUrl: () => process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com",
  paypalConfigured: () => Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
  geminiConfigured: () => Boolean(process.env.GEMINI_API_KEY),
  modelReasoning: () => process.env.LLM_MODEL_REASONING || "gemini-3.1-pro-preview",
  modelFast: () => process.env.LLM_MODEL_FAST || "gemini-3.5-flash",
  capPerOrderCents: () => Math.round(Number(process.env.REFUND_CAP_PER_ORDER_USD || 100) * 100),
  capPerBatchCents: () => Math.round(Number(process.env.REFUND_CAP_PER_BATCH_USD || 2000) * 100),
  demoMode: () => (process.env.DEMO_MODE ?? "true") !== "false",
  appBaseUrl: () => process.env.APP_BASE_URL || "http://localhost:3000",
};
