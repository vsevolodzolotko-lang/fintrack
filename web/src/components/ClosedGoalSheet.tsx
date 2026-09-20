import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Pencil, TriangleAlert } from "lucide-react";
import { api, type ClosedGoal } from "../api";
import { fmtGrn, fmtDayKyiv } from "../format";

// Деталі закритої цілі й дві дії. Доти закриття було необоротним і невидимим:
// ціль просто зникала з картки, а spentAmount писався в БД і ніде не читався.
export function ClosedGoalSheet({ goal, unallocated, onClose, onEditSpent }: {
  goal: ClosedGoal;
  /** Вільний пул зараз — щоб попередити про мінус до натискання. */
  unallocated: bigint;
  onClose: () => void;
  /** Закриває цей шит і відкриває нумпад: два шити ніколи не стоять разом. */
  onEditSpent: () => void;
}) {
  const qc = useQueryClient();
  const allocated = BigInt(goal.allocated);
  // Повернення вертає алокації цілі в «Відкладено», а гроші з картки вже пішли.
  const willGoNegative = allocated > unallocated;

  const reopen = useMutation({
    mutationFn: () => api.post(`/goals/${goal.id}/reopen`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["goals"] }); onClose(); },
  });

  return (
    <>
      <div className="amt-backdrop" onClick={onClose} />
      <div className="amt-sheet">
        <div className="amt-grip" />
        <div>
          <div className="amt-title">«{goal.title}» — куплено</div>
        </div>

        <div className="orph-detail"><span>Витрачено</span><span>{fmtGrn(goal.spentAmount)}</span></div>
        <div className="orph-detail"><span>Відкладено було</span><span>{fmtGrn(goal.allocated)}</span></div>
        <div className="orph-detail"><span>Ціль</span><span>{fmtGrn(goal.targetAmount)}</span></div>
        {goal.closedAt && (
          <div className="orph-detail"><span>Закрито</span><span>{fmtDayKyiv(goal.closedAt)}</span></div>
        )}

        {willGoNegative && (
          <div className="goals-closed-warn">
            <TriangleAlert size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              Повернення відкладе {fmtGrn(goal.allocated)}, а вільно лише {fmtGrn(unallocated)} —
              пул піде в мінус. Гроші з картки вже витрачені.
            </span>
          </div>
        )}

        {reopen.isError && <div className="amt-error">{(reopen.error as Error).message}</div>}

        {/* Акценти навмисне такі: правка суми — часта й безпечна, повернення —
            рідке й здатне загнати пул у мінус. Домінувати має безпечніша, бо
            золота кнопка збирає випадкові тапи. */}
        <div className="sheet-actions">
          <button className="sheet-btn ghost" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
            {reopen.isPending ? "…" : <><RotateCcw size={14} /> Вернути в активні</>}
          </button>
          <button className="sheet-btn primary" onClick={onEditSpent}>
            <Pencil size={14} /> Правити суму
          </button>
        </div>
      </div>
    </>
  );
}
