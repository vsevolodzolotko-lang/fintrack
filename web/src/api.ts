const BASE = import.meta.env.VITE_API_BASE ?? "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    // Content-Type лише за наявності тіла — інакше Fastify падає на
    // порожньому JSON (FST_ERR_CTP_EMPTY_JSON_BODY) для bodyless POST/DELETE.
    headers: {
      ...(init?.body != null ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(typeof message === "string" ? message : JSON.stringify(message));
  }
}

export const api = {
  get: <T>(p: string) => req<T>(p),
  post: <T>(p: string, body?: unknown) => req<T>(p, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(p: string, body?: unknown) => req<T>(p, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(p: string, body?: unknown) => req<T>(p, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(p: string) => req<T>(p, { method: "DELETE" }),
};

// ─── Типи відповідей ───
export interface Me { id: string; email: string; displayName: string }

export interface UserLite { id: string; displayName: string }

export interface CycleStats {
  cycleId: string;
  startDate: string;
  expectedEnd: string;
  endDate: string | null;
  incomeTotal: string;
  investmentBudget: string;
  goalsBudget: string;
  livingBudget: string;
  goalsCarryUah: string;
  investCarryUah: string;
  livingCarryUah: string;
  livingSpent: string;
  goalsContributed: string;
  toGoals: string;
  investmentContributed: string;
  toInvest: string;
  daysLeft: number;
  daysElapsed: number;
  totalDays: number;
  dailyLimit: string;
  spentToday: string;
  safeToday: string;
  overspendForecast: boolean;
  reservedCommitment: string;
  flexibleBudget: string;
  flexibleRemaining: string;
  byCategory: CategoryStat[];
}

export interface PendingClosure {
  cycleId: string;
  startDate: string;
  endDate: string;
  nextCycleId: string;
  leftoverFact: string | null;   // копійки рядком
  leftoverComputed: string;
  delta: string | null;
}

export interface CategoryStat {
  categoryId: string;
  name: string;
  color: string | null;
  spent: string;
  planned: string | null;
  reserveUpfront: boolean;
}

export interface SuggestedBudget {
  categoryId: string;
  name: string;
  spentLastCycle: string;
  suggestedPlan: string;
  reserveUpfront: boolean;
  note: string | null;
}

export interface CycleListItem {
  id: string;
  startDate: string;
  endDate: string | null;
  expectedEnd: string;
  status: "ACTIVE" | "CLOSED";
}

export interface Account {
  id: string; kind: string; isGoals: boolean; title: string; balance: string; currencyCode: number;
}

export interface PeriodPace {
  spent: string;
  usual: string;
  deltaPct: number | null;
}

export interface PaceStats {
  baselineDays: number;
  avgDay: string;
  avgWeek: string;
  avgMonth: string;
  day: PeriodPace;
  week: PeriodPace;
  month: PeriodPace;
}

export interface Dashboard {
  cycle: CycleStats | null;
  needsReview: number;
  incomeCandidates: number;
  incomeCandidatesAmount: string;
  accounts: Account[];
  spendingByCategory: { categoryId: string | null; name: string; color: string | null; amount: string }[];
  byPerson: { userId: string | null; spent: string }[];
  byPersonCategory: { userId: string | null; categoryId: string | null; name: string; color: string | null; amount: string }[];
  pace: PaceStats | null;
}

export type IncomeKind = "SALARY" | "OTHER_INCOME" | "REFUND" | "CASHBACK" | "SELF_TRANSFER";

export interface IncomePreview {
  investment: string;
  goals: string;
  living: string;
  suggestsNewCycle: boolean;
}

export interface Tx {
  id: string;
  time: string;
  amount: string;
  description: string;
  envelope: string;
  isIncome: boolean;
  incomeKind: IncomeKind | null;
  suggestedKind?: IncomeKind | null;
  incomePreview?: IncomePreview | null;
  needsReview: boolean;
  userId: string | null;
  categoryId: string | null;
  category?: { id: string; name: string; color: string | null } | null;
  account?: { title: string; kind: string };
  user?: { displayName: string } | null;
}

export interface Category {
  id: string;
  name: string;
  color: string | null;
  defaultEnvelope: string;
  plannedAmount: string | null;
  reserveUpfront: boolean;
  radialSlot: number | null;
  radialOrder: number;
  shortName: string | null;
}

export interface AppSettings { salaryDayOfMonth: number | null; goalsAccountId: string | null }

export interface Goal {
  id: string;
  title: string;
  targetAmount: string;
  deadline: string | null;
  sortOrder: number;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  balance: string;
  progress: number;
  reached: boolean;
}

export interface ClosedGoal {
  id: string;
  title: string;
  targetAmount: string;
  spentAmount: string;
  closedAt: string | null;
  allocated: string;
  delta: string;
}

export interface ArchivedGoal {
  id: string;
  title: string;
  targetAmount: string;
  allocated: string;
}

export interface GoalsResponse {
  container: { accountId: string | null; balance: string; allocated: string; unallocated: string };
  goals: Goal[];
  closed: ClosedGoal[];
  closedSpentTotal: string;
  archived: ArchivedGoal[];
}

// ─── Інвестиції ───
export type InstrumentKind = "OVDP" | "REIT" | "CRYPTO";

export interface InvestTarget {
  kind: InstrumentKind;
  targetUah: string;
  contributedUah: string;
  remainingUah: string;
  done: boolean;
  flow: InvestFlow;
}

export interface InvestCashflow {
  date: string;
  kind: "COUPON" | "REDEMPTION";
  amountUah: string;
}

export interface InvestLadderItem {
  id: string;
  amountUah: string;
  bondCostUah: string | null;
  quantity: number | null;
  date: string;
  maturityDate: string;
  note: string | null;
  yieldPct: string | null;
  expectedReturnUah: string | null;
  cashflows: InvestCashflow[];
}

export interface InvestmentPlanResponse {
  active: boolean;
  cycleId: string | null;
  investmentBudget: string;
  incomeTotal: string;
  totalContributed: string;
  totalRemaining: string;
  stepsDone: number;
  targets: InvestTarget[];
  cumulative: { OVDP: string; REIT: string; CRYPTO: string; total: string };
  ladder: InvestLadderItem[];
  ovdpCarryUah: string;
  investCarryUah: string;
  inzhurFreeUah: string;
  ovdpProjection: {
    investedUah: string;
    accruedNowUah: string;
    expectedUah: string;
    couponsReceivedUah: string;
    couponsUpcomingUah: string;
    series: { date: string; valueUah: string }[];
  } | null;
}

export interface InvestSuggestion {
  txId: string;
  amount: string;
  description: string;
  date: string;
  guessedKind: InstrumentKind;
}

export interface InvestContributionInput {
  kind: InstrumentKind;
  amountUah: number;
  maturityDate?: string;
  yieldPct?: number;
  quantity?: number;
  bondCostUah?: number;
  cashflows?: { date: string; kind: "COUPON" | "REDEMPTION"; amountUah: number }[];
  asset?: string;
  note?: string;
  monoTxId?: string;
}

export interface ContributionDraft {
  id: string;
  kind: InstrumentKind;
  /** 1 = відправка, 2 = купівля (лише ОВДП), 3 = запис. */
  step: number;
  sentUah: string | null;
  boughtQty: number | null;
  /** ОВДП: ціна за штуку в момент купівлі (крок 2), копійки — необовʼязково. */
  unitPriceUah: string | null;
}

export interface ContributionDraftInput {
  step: number;
  /** Гривні числом — сервер множить на 100 сам. */
  sentUah?: number;
  boughtQty?: number;
  /** Гривні з копійками числом — сервер множить на 100 сам. */
  unitPriceUah?: number;
}

export interface InvestFlow {
  /** Скільки відправити зараз. */
  sendUah: string;
  /** Частка місяця без недобору — для підпису «65% інвестбюджету». */
  baseUah: string;
  carryUah: string;
  /** 3 — ОВДП, 2 — REIT і крипта без ключа, 0 — крипта з ключем Binance. */
  steps: 0 | 2 | 3;
  /** Орієнтир кроку 2; null, коли історії купівель немає. */
  lotEstimate: { count: number; unitPriceUah: string } | null;
}

export interface ReitSeriesPoint {
  date: string;
  cumulativeUah: string;
}

export interface ReitValuationRow {
  id: string;
  date: string;
  valueUah: string;
  investedUah: string | null;
  dividendsUah: string | null;
  freeUah: string;
  note: string | null;
}

export interface ReitGrowthResponse {
  contributedTotal: string;
  contributedAtAsOf: string | null;
  contributedAfterAsOf: string;
  costBasisUah: string | null;
  capitalGainUah: string | null;
  dividendsUah: string;
  contributedSeries: ReitSeriesPoint[];
  valuations: ReitValuationRow[];
  latestValue: string | null;
  latestFreeUah: string | null;
  latestWorthUah: string | null;
  gainUah: string | null;
  gainPct: number | null;
  asOf: string | null;
}

export type InvestEventType = "CONTRIBUTION" | "COUPON" | "REDEMPTION" | "VALUATION" | "CONVERSION";
export type CryptoUnavailable = "not_configured" | "no_rate" | "no_data";

export interface InvestEvent {
  id: string;
  type: InvestEventType;
  kind: InstrumentKind;
  date: string;
  amountUah: string;
  deletable: boolean;
  quantity?: number;
  usdtQty?: string;
  freeUah?: string;
  note?: string;
  shortfallUah?: string;
  fromAsset?: string;
  fromAmount?: string;
  toAsset?: string;
  toAmount?: string;
}

export interface InvestHistoryResponse {
  firstEventAt: string | null;
  summary: {
    investedUah: string;
    ovdpCouponsUah: string;
    reitGainUah: string | null;
    cryptoGainUah: string | null;
    cryptoUnavailable: CryptoUnavailable | null;
    gainUah: string;
    nowUah: string;
  };
  events: InvestEvent[];
}

// ─── Binance (крипта) ───
export interface BinanceStatus {
  configured: boolean;
  keyMasked: string | null;
  restrictions: {
    ok: boolean;
    error?: string;
    enableReading?: boolean | null;
    enableWithdrawals?: boolean | null;
    enableSpotAndMarginTrading?: boolean | null;
    checkedAt: string;
  } | null;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  counts: { p2pOrders: number; conversions: number };
}

export interface CryptoPnlFlags {
  spreadUnknown: boolean;
  feesIncomplete: boolean;
  priceMissing: boolean;
}

export interface CryptoConversionRow {
  id: string;
  source: "CONVERT" | "SPOT";
  fromAmount: string;
  toAsset: string;
  toAmount: string;
  feeUsdt: string | null;
  tradeTime: string;
  outOfTracking: boolean;
}

export interface CryptoCandidateOrder {
  id: string;
  tradeTime: string;
  fiatAmountUah: string;
  assetQty: string;
  remainingQty: string;
}

export interface CryptoInvestment {
  id: string;
  orderNumber: string;
  tradeTime: string;
  usdtQty: string;
  unitPriceUah: string;
  marketRateUah: string | null;
  contributionUah: string;
  currentValueUah: string;
  netProfitUah: string;
  grossProfitUah: string;
  inputLossUah: string;
  spreadUah: string;
  feesUah: string;
  effectiveInvestedUah: string;
  leftoverUsdt: string;
  flags: CryptoPnlFlags;
  conversions: CryptoConversionRow[];
}

export interface CryptoAssetPosition {
  asset: string;
  qty: string;
  priceUsdt: string | null;
  valueUah: string;
}

export interface CryptoBalanceIssue {
  asset: string;
  kind: "UNTRACKED" | "SHORTFALL" | "SURPLUS";
  trackedQty: string;
  actualQty: string;
  diffValueUsdt: string;
}

export interface CryptoPortfolioResponse {
  configured: boolean;
  lastSyncAt: string | null;
  pricesAsOf: string | null;
  empty?: boolean;
  ratesUnavailable?: boolean;
  usdtUahRate?: string;
  totals?: {
    contributionUah: string;
    effectiveInvestedUah: string;
    currentValueUah: string;
    netProfitUah: string;
    grossProfitUah: string;
    inputLossUah: string;
    spreadUah: string;
    feesUah: string;
    flags: CryptoPnlFlags & { untrackedUsdtSource: boolean };
  };
  assets?: CryptoAssetPosition[];
  investments?: CryptoInvestment[];
  orphanConversions?: CryptoConversionRow[];
  reconciliation?: {
    balances: { asset: string; qty: string }[];
    mismatch: boolean;
    issues: CryptoBalanceIssue[];
    walletsPartial: boolean;
  } | null;
}

export interface CryptoSeriesResponse {
  configured: boolean;
  empty: boolean;
  ratesUnavailable?: boolean;
  days: { date: string; grossUah: string }[];
}

// Історія витрат. Суми — рядки копійок, як усюди.
export interface HistoryMonth {
  ym: string;
  spent: string;
  partial: "start" | "running" | null;
}

export interface HistoryMonths {
  since: string;          // "YYYY-MM-DD"
  limit: string | null;   // бюджет побуту поточного циклу
  months: HistoryMonth[];
}

export interface HistoryCategoryRow {
  categoryId: string | null;
  name: string;
  color: string | null;
  spent: string;
  delta: string | null;
}

export interface HistoryMonthDetail {
  ym: string;
  prevYm: string | null;
  categories: HistoryCategoryRow[];
}

export interface HistoryMerchant {
  description: string;
  count: number;
  spent: string;
}

export interface HistoryPerson {
  userId: string | null;
  spent: string;
}

export interface HistoryCategoryDetail {
  categoryId: string;
  name: string;
  color: string | null;
  months: { ym: string; spent: string; partial: "start" | "running" | null }[];
  merchants: HistoryMerchant[];
  byPerson: HistoryPerson[];
}
