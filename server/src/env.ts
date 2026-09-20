function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: req("DATABASE_URL"),
  sessionSecret: req("SESSION_SECRET"),
  tokenEncKey: req("TOKEN_ENC_KEY"), // 64 hex chars = 32 bytes
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
  tz: process.env.TZ ?? "Europe/Kyiv",
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? "",
    privateKey: process.env.VAPID_PRIVATE_KEY ?? "",
    subject: process.env.VAPID_SUBJECT ?? "",
  },
  binance: {
    apiKey: process.env.BINANCE_API_KEY ?? "",
    apiSecret: process.env.BINANCE_API_SECRET ?? "",
    // ISO-дата: угоди раніше неї не імпортуються (лінія відліку трекінгу)
    syncFrom: process.env.BINANCE_SYNC_FROM || "",
    spotSymbols: (process.env.BINANCE_SPOT_SYMBOLS || "BTCUSDT,ETHUSDT")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  isProd: (process.env.NODE_ENV ?? "development") === "production",
};
