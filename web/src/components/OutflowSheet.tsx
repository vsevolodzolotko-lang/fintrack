import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PiggyBank, ShoppingBag } from "lucide-react";
import { api, type Goal, type GoalOutflow } from "../api";
import { fmtGrnExact, fmtDayKyiv } from "../format";

// Списання з білої картки, які загнали «Вільно» в мінус. Кожен рядок
// розвʼязується вручну: «З цілі» — гроші пішли на саму ціль чи поза бюджет;
// «Побут» — це звичайна витрата, її ще й треба врахувати в побуті (Review).
export function OutflowSheet({ outflows, goals, unallocated, onClose }: {
  outflows: GoalOutflow[];
  goals: Goal[];
  unallocated: bigint;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const needsGoal = unallocated < 0n && goals.length > 1;
  const [goalId, setGoalId] = useState<string>(goals[0]?.id ?? "");
  const [err, setErr] = useState("");

  const cover = useMutation({
    mutationFn: (v: { txId: string; asLiving: boolean }) =>
      api.post(`/goals/outflows/${v.txId}/cover`, { goalId: needsGoal ? goalId : undefined, asLiving: v.asLiving }),
    onSuccess: () => {
      setErr("");
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (e) => setErr((e as Error).message),
  });

  const deficit = unallocated < 0n ? -unallocated : 0n;

  return (
    <>
      <div className="amt-backdrop" onClick={onClose} />
      <div className="amt-sheet">
        <div className="amt-grip" />
        <div>
          <div className="amt-title">Списання з білої картки</div>
          <div className="amt-subtitle">
            {deficit > 0n
              ? <>Вільно в мінусі на {fmtGrnExact(deficit)}: з картки пішли гроші, які цілі ще вважають своїми.</>
              : <>Пул збалансовано. Ці списання ще не привʼязані до цілей.</>}
          </div>
        </div>

        {needsGoal && (
          <div className="wo-pick">
            <span className="wo-pick-label">Списати з цілі</span>
            <div className="sheet-seg">
              {goals.map((g) => (
                <button key={g.id} className={`sheet-seg-btn ${g.id === goalId ? "active" : ""}`} onClick={() => setGoalId(g.id)}>
                  {g.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {outflows.length === 0 && <p className="hint wo-empty">Списань не знайдено. Якщо мінус лишився, звірте баланс картки в Mono.</p>}

        <ul className="wo-list">
          {outflows.map((o) => (
            <li key={o.id} className={`wo-row ${o.explains ? "hi" : ""}`}>
              <div className="wo-main">
                <span className="wo-desc">{o.description}</span>
                <span className="wo-meta">{fmtDayKyiv(o.time)}</span>
              </div>
              <b className="wo-amt">{fmtGrnExact(o.amount)}</b>
              <div className="wo-actions">
                <button className="mini" disabled={cover.isPending} onClick={() => cover.mutate({ txId: o.id, asLiving: false })}>
                  <PiggyBank size={14} /> З цілі
                </button>
                <button className="mini" disabled={cover.isPending} onClick={() => cover.mutate({ txId: o.id, asLiving: true })}>
                  <ShoppingBag size={14} /> Побут
                </button>
              </div>
            </li>
          ))}
        </ul>

        {err && <div className="amt-error">{err}</div>}

        <div className="sheet-actions">
          <button className="sheet-btn ghost" onClick={onClose}>Закрити</button>
        </div>
      </div>
    </>
  );
}
