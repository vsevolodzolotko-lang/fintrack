// Клієнт Monobank Personal API. Rate limit: 1 req/60s на client-info та statement.
const BASE = "https://api.monobank.ua";

export interface MonoAccount {
  id: string;
  sendId: string;
  balance: number; // копійки
  creditLimit: number;
  type: string; // black | white | platinum | iron | fop | yellow | eAid
  currencyCode: number;
  cashbackType?: string;
  maskedPan: string[];
  iban: string;
}

export interface MonoJar {
  id: string;
  sendId: string;
  title: string;
  description?: string;
  currencyCode: number;
  balance: number;
  goal?: number;
}

export interface MonoClientInfo {
  clientId: string;
  name: string;
  webHookUrl?: string;
  permissions: string;
  accounts: MonoAccount[];
  jars?: MonoJar[];
}

export interface MonoStatementItem {
  id: string;
  time: number; // unix seconds
  description: string;
  comment?: string;
  mcc: number;
  originalMcc: number;
  hold: boolean;
  amount: number; // копійки, signed
  operationAmount: number;
  currencyCode: number;
  commissionRate: number;
  cashbackAmount: number;
  balance: number;
  receiptId?: string;
  invoiceId?: string;
  counterEdrpou?: string;
  counterIban?: string;
  counterName?: string;
}

async function call<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "X-Token": token, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status === 429) {
    throw new Error("MONO_RATE_LIMIT"); // 1 req/60s перевищено
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Mono API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export function getClientInfo(token: string): Promise<MonoClientInfo> {
  return call<MonoClientInfo>(token, "/personal/client-info");
}

// from/to — unix seconds. Максимум 31 доба + 1 год за запит.
export function getStatement(token: string, account: string, from: number, to: number) {
  return call<MonoStatementItem[]>(token, `/personal/statement/${account}/${from}/${to}`);
}

export function setWebhook(token: string, webHookUrl: string): Promise<unknown> {
  return call(token, "/personal/webhook", {
    method: "POST",
    body: JSON.stringify({ webHookUrl }),
  });
}
