import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { api, type Category, type IncomeKind, type Tx, type UserLite } from "../api";
import { fmtGrn } from "../format";
import { IncomeCard } from "../components/IncomeCard";
import { NewCategorySheet } from "../components/NewCategorySheet";
import { RadialPicker } from "../components/RadialPicker";
import { buildSlots, RADIAL_SLOTS } from "../radialSlots";

interface Props {
  onClose: () => void;
}

export function Review({ onClose }: Props) {
  const qc = useQueryClient();
  const { data: allTxs, isLoading } = useQuery({
    queryKey: ["review-txs"],
    queryFn: () => api.get<Tx[]>("/transactions?needsReview=true&limit=50"),
  });
  const { data: cats, isError: catsError } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories"),
  });
  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<UserLite[]>("/users"),
  });

  const [cards, setCards] = useState<Tx[] | null>(null);
  const [total, setTotal] = useState(0);
  const [newOpen, setNewOpen] = useState(false);
  // Дефолт — власник із токена, і НІЧИЙ фолбек на того, хто розбирає:
  // для tx.userId === null жоден чіп не підсвічується, бо чіп, який світиться,
  // мусить чесно означати «це буде записано», а не «поточний користувач».
  // ВАЖЛИВО: поки personTouched === false, userId у PATCH не йде взагалі —
  // інакше вечірній розбір одним партнером перетирає атрибуцію витрат іншого, а «Хто
  // скільки» перестає бути правдою (знахідка 02 UX-аудиту).
  const [personId, setPersonId] = useState<string | null>(null);
  const [personTouched, setPersonTouched] = useState(false);
  // Останній розібраний — рядок з undo під сценою, поки не з'явиться наступний.
  const [last, setLast] = useState<{ tx: Tx; cat: Category } | null>(null);

  // Черга: надходження ПЕРШИМИ, потім витрати. Порядок навмисний — надходження
  // визначають бюджет, а витрати ділять уже відомий; у зворотному порядку
  // колесо категорій крутиться при неправильному денному ліміті.
  // Будь-яке позитивне з прапорцем розгляду — картка надходження, навіть якщо
  // тип уже стоїть (напр. скинули категорію вручну). Інакше лічильник CTA
  // рахує рядок, якого в черзі нема, і зняти прапорець нічим.
  if (allTxs && cards === null) {
    const incoming = allTxs.filter((t) => Number(t.amount) > 0);
    const expenses = allTxs.filter((t) => Number(t.amount) < 0);
    const queue = [...incoming, ...expenses];
    setCards(queue);
    setTotal(queue.length);
  }

  const slots = useMemo(() => buildSlots(cats ?? []), [cats]);

  const pickMut = useMutation({
    mutationFn: (v: { id: string; categoryId: string; envelope: string; userId?: string | null }) =>
      api.patch(`/transactions/${v.id}`, {
        categoryId: v.categoryId,
        envelope: v.envelope,
        // userId лише коли ключ присутній: сервер трактує його відсутність
        // як «не чіпати власника» (zod-схема), а не як явний null.
        ...(v.userId !== undefined ? { userId: v.userId } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["txs"] });
    },
  });

  const incomeKindMut = useMutation({
    mutationFn: (v: { id: string; kind: IncomeKind; startsCycle?: boolean }) =>
      api.post(`/transactions/${v.id}/income-kind`, { kind: v.kind, startsCycle: v.startsCycle }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["txs"] });
      qc.invalidateQueries({ queryKey: ["invest-plan"] });
      qc.invalidateQueries({ queryKey: ["goals"] });
    },
  });

  const pop = () => setCards((cs) => (cs ? cs.slice(1) : []));

  // Тап по картці — «подивлюсь пізніше в цій сесії»: картка йде в кінець стосу.
  const cycleToBack = () =>
    setCards((cs) => (cs && cs.length > 1 ? [...cs.slice(1), cs[0]] : cs));

  // Undo reverts the server too: clearing the category re-queues the tx.
  const undoMut = useMutation({
    mutationFn: (id: string) => api.patch(`/transactions/${id}`, { categoryId: null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["txs"] });
    },
  });

  // Reopening the overlay should start from a fresh queue, not a stale cache
  // that still holds cards filed last session.
  useEffect(() => () => {
    qc.removeQueries({ queryKey: ["review-txs"] });
  }, [qc]);

  const handlePick = (cat: Category) => {
    const tx = cards?.[0];
    if (!tx) return;
    pickMut.mutate({
      id: tx.id,
      categoryId: cat.id,
      envelope: cat.defaultEnvelope,
      // Особу шлемо тільки якщо її свідомо перемкнули.
      userId: personTouched ? personId : undefined,
    });
    pop();
    setLast({ tx, cat });
  };

  const handleUndo = () => {
    if (!last) return;
    const { tx } = last;
    setCards((cs) => [tx, ...(cs ?? [])]);
    setLast(null);
    undoMut.mutate(tx.id);
  };

  // Create a category on the fly, then file the current tx into it.
  const createMut = useMutation({
    mutationFn: (v: { name: string; slot: number }) =>
      api.post<Category>("/categories", {
        name: v.name,
        defaultEnvelope: "LIVING", // усі витрати — один піт 70%
        // Колір — колір сектора, куди кладемо категорію, а не рядок з
        // ротаційної палітри: сектор уже вибрано, вигадувати відтінок нема сенсу.
        color: RADIAL_SLOTS[v.slot].color,
        radialSlot: v.slot,
        // Останній лист у секторі: фан із двох листів починає відкриватися сам,
        // без окремої логіки.
        radialOrder: Math.max(0, ...slots[v.slot].leaves.map((c) => c.radialOrder)) + 10,
      }),
    onSuccess: (created) => {
      handlePick(created);
      qc.invalidateQueries({ queryKey: ["categories"] });
      setNewOpen(false);
    },
  });

  const done = total - (cards?.length ?? total);
  const progressPct = total > 0 ? `${(done / total) * 100}%` : "0%";
  const allDone = cards !== null && cards.length === 0;
  const current = cards?.[0];
  const currentId = current?.id;

  useEffect(() => {
    setPersonId(current?.userId ?? null);
    setPersonTouched(false);
  }, [currentId, current?.userId]);

  return (
    <div className="review-overlay">
      <div className="review-header">
        <div className="review-header-row">
          <button className="review-close" onClick={onClose}>
            <X size={18} color="#EDEFF5" strokeWidth={2.2} />
          </button>
          <div className="review-title">Розгляд транзакцій</div>
          <div className="review-counter">{done}/{total}</div>
        </div>
        <div className="review-progress">
          <div className="review-progress-fill" style={{ width: progressPct }} />
        </div>
      </div>

      {isLoading && <div className="wheel-loading">Завантаження…</div>}

      {allDone && (
        <div className="review-done">
          <div className="review-done-title" style={{ color: "var(--green)", fontSize: 34 }}>Готово</div>
          <div className="review-done-sub">Розібрано {total} — по категоріях і людях</div>
          <button className="review-done-btn" onClick={onClose}>На дашборд</button>
        </div>
      )}

      {current && Number(current.amount) > 0 && (
        <IncomeCard
          key={current.id}
          tx={current}
          busy={incomeKindMut.isPending}
          onPick={(kind, startsCycle) => {
            incomeKindMut.mutate({ id: current.id, kind, startsCycle });
            pop();
            setLast(null);
          }}
        />
      )}

      {current && Number(current.amount) < 0 && !cats && (
        <div className="wheel-loading">
          {catsError ? "Не вдалося завантажити категорії" : "Завантаження…"}
        </div>
      )}

      {current && Number(current.amount) < 0 && cats && (
        <>
          <RadialPicker
            key={current.id}
            tx={current}
            slots={slots}
            users={users ?? []}
            personId={personId}
            personTouched={personTouched}
            onPersonChange={(id) => { setPersonId(id); setPersonTouched(true); }}
            onCommit={handlePick}
            onCycle={(cards?.length ?? 0) > 1 ? cycleToBack : undefined}
            pileLayers={Math.max(0, (cards?.length ?? 1) - 1)}
          />

          {last && (
            <div className="radial-undo-row">
              <span className="radial-undo-dot" style={{ background: last.cat.color ?? "#8a90a2" }} />
              <span className="radial-undo-text">
                {last.tx.description} {fmtGrn(last.tx.amount)} → {last.cat.name}
              </span>
              <button className="radial-undo-btn" onClick={handleUndo}>Скасувати</button>
            </div>
          )}

          <div className="radial-footer">
            <button className="radial-later" onClick={pop}>Пізніше</button>
            <button className="radial-add" onClick={() => setNewOpen(true)}>
              <Plus size={22} strokeWidth={2.6} />
            </button>
          </div>
        </>
      )}

      {newOpen && (
        <NewCategorySheet
          busy={createMut.isPending}
          onCancel={() => setNewOpen(false)}
          onCreate={(name, slot) => createMut.mutate({ name, slot })}
        />
      )}
    </div>
  );
}
