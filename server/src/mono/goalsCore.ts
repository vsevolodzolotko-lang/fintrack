export interface GoalInput {
  id: string;
  title: string;
  targetAmount: bigint;
  deadline: Date | null;
  sortOrder: number;
}

export interface AllocationInput {
  goalId: string;
  amount: bigint; // signed: + додати, − повернути
}

export interface GoalSummary {
  id: string;
  title: string;
  targetAmount: bigint;
  deadline: Date | null;
  sortOrder: number;
  balance: bigint;   // сума алокацій цілі
  progress: number;  // 0..1
  reached: boolean;  // balance >= target && target > 0
}

export interface GoalsSummary {
  containerBalance: bigint;
  allocated: bigint;   // сума балансів усіх поданих цілей
  unallocated: bigint; // containerBalance − allocated
  goals: GoalSummary[];
}

// Чиста математика цілей — без Prisma, тестується юнітами.
// Подавати лише АКТИВНІ цілі (архів/завершені не входять у allocated).
export function computeGoalsSummary(
  containerBalance: bigint,
  goals: GoalInput[],
  allocations: AllocationInput[],
): GoalsSummary {
  const balByGoal = new Map<string, bigint>();
  for (const a of allocations) {
    balByGoal.set(a.goalId, (balByGoal.get(a.goalId) ?? 0n) + a.amount);
  }

  let allocated = 0n;
  const goalSummaries: GoalSummary[] = goals.map((g) => {
    const balance = balByGoal.get(g.id) ?? 0n;
    allocated += balance;
    const reached = g.targetAmount > 0n && balance >= g.targetAmount;
    let progress = 0;
    if (g.targetAmount > 0n) {
      progress = Number(balance) / Number(g.targetAmount);
      if (progress < 0) progress = 0;
      if (progress > 1) progress = 1;
    }
    return { id: g.id, title: g.title, targetAmount: g.targetAmount, deadline: g.deadline, sortOrder: g.sortOrder, balance, progress, reached };
  });

  return { containerBalance, allocated, unallocated: containerBalance - allocated, goals: goalSummaries };
}

// Повертає текст помилки (укр.) або null, якщо алокація допустима. amount — зі знаком.
export function validateAllocation(unallocated: bigint, goalBalance: bigint, amount: bigint): string | null {
  if (amount === 0n) return "Нульова сума";
  if (amount > 0n && amount > unallocated) return "Недостатньо нерозподілених коштів";
  if (amount < 0n && -amount > goalBalance) return "У цілі недостатньо коштів";
  return null;
}

export function validateTransfer(fromBalance: bigint, amount: bigint): string | null {
  if (amount <= 0n) return "Сума має бути додатною";
  if (amount > fromBalance) return "У цілі-джерелі недостатньо коштів";
  return null;
}

export interface ClosedGoalInput {
  id: string;
  title: string;
  targetAmount: bigint;
  spentAmount: bigint;
  closedAt: Date | null;
}

export interface ClosedGoalSummary extends ClosedGoalInput {
  allocated: bigint; // сума алокацій цілі на момент закриття
  delta: bigint;     // spentAmount − allocated: + доплатили з вільного, − зекономили
}

// Закриті цілі: скільки насправді витратили і чи збіглося це з відкладеним.
// «Відкладено було» рахується з алокацій, а не з окремого поля: алокації
// закритої цілі лишаються в історії й не мутуються, а друге джерело істини
// дало б дрейф. spentTotal — сума витраченого, не відкладеного: група
// відповідає на «скільки грошей пішло на досягнуті цілі».
export function computeClosedGoals(
  goals: ClosedGoalInput[],
  allocations: AllocationInput[],
): { goals: ClosedGoalSummary[]; spentTotal: bigint } {
  const balByGoal = new Map<string, bigint>();
  for (const a of allocations) {
    balByGoal.set(a.goalId, (balByGoal.get(a.goalId) ?? 0n) + a.amount);
  }

  let spentTotal = 0n;
  const summaries = goals.map((g) => {
    const allocated = balByGoal.get(g.id) ?? 0n;
    spentTotal += g.spentAmount;
    return { ...g, allocated, delta: g.spentAmount - allocated };
  });

  return { goals: summaries, spentTotal };
}

// ─── Списання з білої картки, не покриті цілями ───
// Баланс контейнера вже впав, а алокації — ні, тому «Вільно» в мінусі.
// Кожне списання розвʼязується вручну (див. routes/goals.ts): автоматика зламала б
// флоу «Куплено», де вихідний переказ — це сама покупка цілі.

export interface OutflowInput {
  id: string;
  amount: bigint; // відʼємне
  time: Date;
}

// Які списання пояснюють дефіцит: від найсвіжішого назад, поки сума не покриє
// −unallocated. Порожньо, коли пул не в мінусі; всі — коли списань замало.
export function explainDeficit(unallocated: bigint, outflows: OutflowInput[]): Set<string> {
  const ids = new Set<string>();
  if (unallocated >= 0n) return ids;
  let left = -unallocated;
  const sorted = [...outflows].sort((a, b) => b.time.getTime() - a.time.getTime());
  for (const o of sorted) {
    if (left <= 0n) break;
    ids.add(o.id);
    left -= -o.amount;
  }
  return ids;
}

// Скільки зняти з цілі за це списання: лише те, чого не покрив вільний пул.
// Пул уже збалансований → 0; дефіцит менший за списання → лише дефіцит.
export function goalDeductionFor(unallocated: bigint, outflowAbs: bigint): bigint {
  if (unallocated >= 0n) return 0n;
  const deficit = -unallocated;
  return deficit < outflowAbs ? deficit : outflowAbs;
}
