import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Check, Pencil, Trash2, X, ChevronDown, RotateCcw } from "lucide-react";
import { api, type ClosedGoal, type Goal, type GoalsResponse } from "../api";
import { fmtGrn, fmtGrnExact, fmtDayKyiv } from "../format";
import { AmountSheet } from "./AmountSheet";
import { ClosedGoalSheet } from "./ClosedGoalSheet";
import { originCaption } from "../closedGoals";
import { useToast } from "../toast";

// Копійки → гривні рядком із комою, як їх очікує AmountSheet (decimals: true).
// toFixed(2) рятує від артефактів плаваючої коми на кшталт "1037.7100000000001".
const kopToGrnStr = (kop: string) => (Number(kop) / 100).toFixed(2).replace(".", ",");

export function GoalsCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["goals"], queryFn: () => api.get<GoalsResponse>("/goals") });
  const { showToast } = useToast();
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [err, setErr] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [allocSheet, setAllocSheet] = useState<{ id: string; title: string; amount: string } | null>(null);
  const [closeSheet, setCloseSheet] = useState<{ id: string; title: string; amount: string } | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [closedSheet, setClosedSheet] = useState<ClosedGoal | null>(null);
  // Взаємовиключно з closedSheet: два шити ніколи не стоять один на одному —
  // те саме правило, що вже діє для HelpSheet.
  const [spentSheet, setSpentSheet] = useState<{ id: string; title: string; amount: string } | null>(null);
  // Поки тост висить, рядок не має повертатися рефетчем. Набір тримає цей
  // компонент: провайдер тоста нічого не знає про списки, його справа — таймер.
  const [pendingDelete, setPendingDelete] = useState<Set<string>>(new Set());

  const invalidate = () => qc.invalidateQueries({ queryKey: ["goals"] });

  const create = useMutation({
    mutationFn: () => api.post("/goals", { title, targetAmount: Number(target) }),
    onSuccess: () => { setTitle(""); setTarget(""); setErr(""); invalidate(); },
    onError: (e) => setErr((e as Error).message),
  });
  const allocate = useMutation({
    mutationFn: (v: { id: string; amount: number }) => api.post(`/goals/${v.id}/allocate`, { amount: v.amount }),
    onSuccess: () => { setErr(""); setAllocSheet(null); invalidate(); },
    onError: (e) => setErr((e as Error).message),
  });
  const complete = useMutation({
    mutationFn: (v: { id: string; spentAmount: number }) => api.post(`/goals/${v.id}/complete`, { spentAmount: v.spentAmount }),
    onSuccess: () => { setErr(""); setCloseSheet(null); invalidate(); },
    onError: (e) => setErr((e as Error).message),
  });
  const editSpent = useMutation({
    mutationFn: (v: { id: string; spentAmount: number }) => api.patch(`/goals/${v.id}`, { spentAmount: v.spentAmount }),
    onSuccess: () => { setErr(""); setSpentSheet(null); invalidate(); },
    onError: (e) => setErr((e as Error).message),
  });
  const update = useMutation({
    mutationFn: (v: { id: string; title: string; targetAmount: number }) =>
      api.patch(`/goals/${v.id}`, { title: v.title, targetAmount: v.targetAmount }),
    onSuccess: () => { setEditingId(null); setErr(""); invalidate(); },
    onError: (e) => setErr((e as Error).message),
  });
  const reopen = useMutation({
    mutationFn: (id: string) => api.post(`/goals/${id}/reopen`, {}),
    onSuccess: () => { setErr(""); invalidate(); },
    onError: (e) => setErr((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/goals/${id}`),
    onSuccess: () => { setErr(""); invalidate(); },
    onError: (e) => setErr((e as Error).message),
    // Знімаємо id з pendingDelete лише після відповіді сервера (успіх чи
    // провал), а не на onExpire: список рефетчиться в onSuccess, і якщо
    // прибрати id раніше, рядок встигає блимнути назад до інвалідації.
    onSettled: (_data, _error, id) => {
      setPendingDelete((s) => { const n = new Set(s); n.delete(id); return n; });
    },
  });

  const startEdit = (id: string, curTitle: string, curTargetKop: string) => {
    setEditingId(id);
    setEditTitle(curTitle);
    setEditTarget(String(Number(curTargetKop) / 100));
    setErr("");
  };
  const editValid = editTitle.trim() !== "" && !Number.isNaN(Number(editTarget)) && Number(editTarget) > 0;

  // Закриття цілі завжди питає фактичну суму покупки; невитрачений залишок
  // повертається у вільний пул цілей. Префіл — баланс цілі, копійками, бо
  // фактична витрата тут значуща до копійки.
  const askComplete = (g: Goal) => {
    setErr("");
    setCloseSheet({ id: g.id, title: g.title, amount: kopToGrnStr(g.balance) });
  };

  // Діалог підтвердження вчить тиснути «так» не читаючи. Undo ловить реальну
  // помилку — ту, яку помітили вже після дії.
  const askDelete = (g: Goal) => {
    setEditingId(null);
    setPendingDelete((s) => new Set(s).add(g.id));
    showToast({
      text: `Ціль «${g.title}» видалено`,
      actionLabel: "Скасувати",
      onAction: () => setPendingDelete((s) => { const n = new Set(s); n.delete(g.id); return n; }),
      onExpire: () => remove.mutate(g.id),
    });
  };

  if (!data) return null;
  if (!data.container.accountId) {
    return (
      <div className="card goals-card">
        <h3>Цілі</h3>
        <p className="hint">Оберіть рахунок-контейнер (білу картку) у Налаштуваннях, щоб вести цілі.</p>
      </div>
    );
  }

  const unalloc = BigInt(data.container.unallocated);
  const visibleGoals = data.goals.filter((g) => !pendingDelete.has(g.id));

  return (
    <div className="card goals-card">
      <div className="goals-head">
        <h3>Цілі</h3>
        <span className="goals-cardtag"><i /> біла картка</span>
      </div>

      <div className="goals-total">
        <span className="goals-total-label">Відкладено всього</span>
        <span className="goals-total-sum">{fmtGrn(data.container.allocated)}</span>
      </div>

      {unalloc !== 0n && (
        <div className={`goals-unalloc ${unalloc < 0n ? "neg" : ""}`}>
          Вільно <b>{fmtGrnExact(data.container.unallocated)}</b>
          {unalloc < 0n && <span className="hint"> — перевищення, звірте баланс</span>}
        </div>
      )}

      <ul className="goals-list">
        {visibleGoals.map((g) => (
          <li key={g.id} className="goal-row">
            {editingId === g.id ? (
              <>
                <div className="goal-edit">
                  <input placeholder="Назва цілі" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                  <input placeholder="Сума, грн" inputMode="numeric" value={editTarget} onChange={(e) => setEditTarget(e.target.value)} />
                </div>
                <div className="goal-row-actions">
                  <button className="mini danger" onClick={() => askDelete(g)}>
                    <Trash2 size={14} /> Видалити
                  </button>
                  <button className="mini" onClick={() => setEditingId(null)}><X size={14} /> Скасувати</button>
                  <button className="mini" disabled={!editValid} onClick={() => update.mutate({ id: g.id, title: editTitle.trim(), targetAmount: Number(editTarget) })}>
                    <Check size={14} /> Зберегти
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="goal-row-top">
                  <span>{g.title}</span>
                  <span className="goal-nums"><b>{fmtGrn(g.balance)}</b> / {fmtGrn(g.targetAmount)}</span>
                </div>
                <div className="goal-bar"><div className={`goal-bar-fill ${g.reached ? "done" : ""}`} style={{ width: `${Math.round(g.progress * 100)}%` }} /></div>
                <div className="goal-row-actions">
                  {g.reached
                    ? <span className="goal-caption done">Ціль досягнуто ✓</span>
                    : <span className="goal-caption">{Math.round(g.progress * 100)}% · залишилось {fmtGrn(BigInt(g.targetAmount) - BigInt(g.balance))}</span>}
                  <button
                    className="mini"
                    disabled={unalloc <= 0n || g.reached}
                    onClick={() => { setErr(""); setAllocSheet({ id: g.id, title: g.title, amount: "" }); }}
                  >
                    <Plus size={14} /> Поповнити
                  </button>
                  <button className="mini" onClick={() => startEdit(g.id, g.title, g.targetAmount)}>
                    <Pencil size={14} /> Редагувати
                  </button>
                  <button className="mini" onClick={() => askComplete(g)}><Check size={14} /> Куплено</button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>

      {data.closed.length > 0 && (
        <>
          <button className="goals-closed-group" onClick={() => setShowClosed((v) => !v)}>
            <ChevronDown size={14} strokeWidth={2.5} style={{ transform: showClosed ? "none" : "rotate(-90deg)" }} />
            Куплено · {data.closed.length} · {fmtGrn(data.closedSpentTotal)}
          </button>
          {showClosed && (
            <div className="goals-closed-list">
              {data.closed.map((c) => (
                <button key={c.id} className="goals-closed-row" onClick={() => setClosedSheet(c)}>
                  <span className="goals-closed-main">
                    <span className="goals-closed-title">
                      {c.closedAt && <i>{fmtDayKyiv(c.closedAt)} · </i>}{c.title}
                    </span>
                    <span className="goals-closed-origin">{originCaption(c.spentAmount, c.allocated)}</span>
                  </span>
                  <b>{fmtGrn(c.spentAmount)}</b>
                  <ChevronDown size={14} strokeWidth={2.5} style={{ transform: "rotate(-90deg)", opacity: .6 }} />
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {data.archived.length > 0 && (
        <>
          <button className="goals-closed-group" onClick={() => setShowArchived((v) => !v)}>
            <ChevronDown size={14} strokeWidth={2.5} style={{ transform: showArchived ? "none" : "rotate(-90deg)" }} />
            Скасовані · {data.archived.length}
          </button>
          {showArchived && (
            <div className="goals-closed-list">
              {data.archived.map((a) => (
                <div key={a.id} className="goals-closed-row" style={{ cursor: "default" }}>
                  <span className="goals-closed-main">
                    <span className="goals-closed-title">{a.title}</span>
                    <span className="goals-closed-origin">
                      ціль {fmtGrn(a.targetAmount)}
                      {Number(a.allocated) > 0 && <> · {fmtGrn(a.allocated)} повернулось у вільні</>}
                    </span>
                  </span>
                  <button className="mini" disabled={reopen.isPending} onClick={() => reopen.mutate(a.id)}>
                    <RotateCcw size={14} /> Вернути
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="divider" />
      <div className="goals-new">
        <input placeholder="Нова ціль" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input placeholder="Сума, грн" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} />
        <button disabled={!title || !target || Number.isNaN(Number(target)) || Number(target) <= 0} onClick={() => create.mutate()}><Plus size={16} /></button>
      </div>
      {err && <p className="goals-err">{err}</p>}

      {allocSheet && (
        <AmountSheet
          title={`Поповнити «${allocSheet.title}»`}
          subtitle="З вільного пулу цілей"
          value={allocSheet.amount}
          onChange={(v) => setAllocSheet((s) => (s ? { ...s, amount: v } : s))}
          decimals={false}
          confirmLabel="Поповнити"
          quick={[{ label: "Усе вільне", value: String(Math.floor(Number(unalloc) / 100)) }]}
          busy={allocate.isPending}
          error={err || null}
          onConfirm={() => {
            // Нуль тут — не сума, а порожня дія: поповнення на нуль нічого не
            // змінює, тож обробляємо як помилку введення (як і в старому діалозі).
            const n = Number(allocSheet.amount || "0");
            if (!Number.isFinite(n) || n <= 0) { setErr("Некоректна сума"); return; }
            setErr("");
            allocate.mutate({ id: allocSheet.id, amount: n });
          }}
          onCancel={() => { setAllocSheet(null); setErr(""); }}
        />
      )}

      {closeSheet && (
        <AmountSheet
          title={`«${closeSheet.title}» — скільки фактично витрачено?`}
          subtitle="Невитрачений залишок повернеться у вільний пул"
          value={closeSheet.amount}
          onChange={(v) => setCloseSheet((s) => (s ? { ...s, amount: v } : s))}
          decimals={true}
          confirmLabel="Закрити ціль"
          busy={complete.isPending}
          error={err || null}
          onConfirm={() => {
            // Нуль тут — не помилка: ціль могла дістатись безкоштовно, і весь
            // баланс має піти назад у вільний пул. Guard лише проти NaN/від'ємного.
            const n = Number(closeSheet.amount.replace(",", "."));
            if (!Number.isFinite(n) || n < 0) { setErr("Некоректна сума"); return; }
            setErr("");
            complete.mutate({ id: closeSheet.id, spentAmount: n });
          }}
          onCancel={() => { setCloseSheet(null); setErr(""); }}
        />
      )}

      {closedSheet && (
        <ClosedGoalSheet
          goal={closedSheet}
          unallocated={unalloc}
          onClose={() => setClosedSheet(null)}
          onEditSpent={() => {
            setSpentSheet({ id: closedSheet.id, title: closedSheet.title, amount: kopToGrnStr(closedSheet.spentAmount) });
            setClosedSheet(null);
          }}
        />
      )}

      {spentSheet && (
        <AmountSheet
          title={`«${spentSheet.title}» — фактично витрачено`}
          subtitle="Правка запису; на «Відкладено» і «Вільно» не впливає"
          value={spentSheet.amount}
          onChange={(v) => setSpentSheet((s) => (s ? { ...s, amount: v } : s))}
          decimals={true}
          confirmLabel="Зберегти"
          busy={editSpent.isPending}
          error={err || null}
          onConfirm={() => {
            const n = Number(spentSheet.amount.replace(",", "."));
            if (!Number.isFinite(n) || n < 0) { setErr("Некоректна сума"); return; }
            setErr("");
            editSpent.mutate({ id: spentSheet.id, spentAmount: n });
          }}
          onCancel={() => { setSpentSheet(null); setErr(""); }}
        />
      )}
    </div>
  );
}
