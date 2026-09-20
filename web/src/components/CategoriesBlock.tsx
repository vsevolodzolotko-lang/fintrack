import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { api, type Category, type CycleListItem, type SuggestedBudget } from "../api";
import { RADIAL_SLOTS } from "../radialSlots";

type Tab = "expenses" | "income";

interface Draft {
  plannedUah: string; // текст інпута, грн; "" = без плану
  reserveUpfront: boolean;
}
const toDraft = (c: Category): Draft => ({
  plannedUah: c.plannedAmount != null ? String(Number(c.plannedAmount) / 100) : "",
  reserveUpfront: c.reserveUpfront,
});

// Один блок керування категоріями замість двох списків. Перемикач зверху:
// Витрати (єдиний список категорій витрат + ліміти) / Надходження (пояснення).
export function CategoriesBlock() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("expenses");

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [suggestedFor, setSuggestedFor] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  // Сектор обов'язковий: категорія без radialSlot не існує на колесі
  // (`buildSlots` фільтрує по `c.radialSlot === i`), а Налаштування — єдине
  // місце поза Розглядом, де категорія створюється.
  const [newSlot, setNewSlot] = useState<number | null>(null);

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories"),
  });
  const { data: cycles } = useQuery({
    queryKey: ["cycles"],
    queryFn: () => api.get<CycleListItem[]>("/cycles"),
  });

  // Усі витрати — один піт 70%: категорії витрат = defaultEnvelope LIVING.
  const expenses = (categories ?? []).filter((c) => c.defaultEnvelope === "LIVING");
  const draftOf = (c: Category): Draft => drafts[c.id] ?? toDraft(c);
  const setDraft = (id: string, patch: Partial<Draft>, cat: Category) =>
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? toDraft(cat)), ...patch } }));

  const refCycle = cycles?.find((c) => c.status === "CLOSED") ?? cycles?.[0];

  const suggest = useMutation({
    mutationFn: () => api.get<SuggestedBudget[]>(`/cycles/${refCycle!.id}/suggested-budgets`),
    onSuccess: (rows) => {
      const next: Record<string, Draft> = {};
      const nextNotes: Record<string, string> = {};
      for (const r of rows) {
        next[r.categoryId] = { plannedUah: String(Number(r.suggestedPlan) / 100), reserveUpfront: r.reserveUpfront };
        if (r.note) nextNotes[r.categoryId] = r.note;
      }
      setDrafts((d) => ({ ...d, ...next }));
      setNotes(nextNotes);
      setSuggestedFor(refCycle!.id);
      setMsg(rows.length ? "Пропозиції підставлено — перевір і збережи." : "Немає історії витрат для пропозицій.");
    },
    onError: (e) => setMsg((e as Error).message),
  });

  const save = useMutation({
    mutationFn: async () => {
      const items = expenses.map((c) => {
        const d = draftOf(c);
        const uah = d.plannedUah.trim() === "" ? null : Number(d.plannedUah);
        return { categoryId: c.id, plannedAmount: uah, reserveUpfront: d.reserveUpfront };
      });
      if (suggestedFor) {
        await api.post(`/cycles/${suggestedFor}/apply-budgets`, { items });
      } else {
        const changed = items.filter((it) => {
          const orig = expenses.find((c) => c.id === it.categoryId)!;
          const origUah = orig.plannedAmount != null ? Number(orig.plannedAmount) / 100 : null;
          return it.plannedAmount !== origUah || it.reserveUpfront !== orig.reserveUpfront;
        });
        for (const it of changed) {
          await api.patch(`/categories/${it.categoryId}`, { plannedAmount: it.plannedAmount, reserveUpfront: it.reserveUpfront });
        }
      }
    },
    onSuccess: () => {
      setDrafts({});
      setNotes({});
      setSuggestedFor(null);
      setMsg("Ліміти збережено");
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => setMsg((e as Error).message),
  });

  const create = useMutation({
    mutationFn: () => {
      const slot = newSlot!;
      return api.post<Category>("/categories", {
        name: newName.trim(),
        defaultEnvelope: "LIVING",
        // Колір — колір обраного сектора, а не рядок з ротаційної палітри
        // (див. Review.tsx's createMut — те саме правило).
        color: RADIAL_SLOTS[slot].color,
        radialSlot: slot,
        // Останній лист у секторі — той самий порядок, що й у Розгляді
        // (`Review.tsx`'s createMut), щоб категорія не зʼявлялась першою
        // в чужому фані.
        radialOrder: Math.max(0, ...(categories ?? []).filter((c) => c.radialSlot === slot).map((c) => c.radialOrder)) + 10,
      });
    },
    onSuccess: () => {
      setNewName("");
      setNewSlot(null);
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  // Категорія без сектора вже існує на проді (створена до цієї гілки, коли
  // Налаштування не питали сектор) — і зникла з колеса мовчки. Єдиний спосіб
  // її повернути: призначити сектор тут, PATCH уже це підтримує.
  const setSlot = useMutation({
    mutationFn: (v: { id: string; radialSlot: number }) =>
      api.patch(`/categories/${v.id}`, { radialSlot: v.radialSlot }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/categories/${id}`),
    onSuccess: () => {
      setConfirmId(null);
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["txs"] });
    },
  });

  return (
    <div className="card">
      <div className="sheet-seg" style={{ marginBottom: 14 }}>
        <button className={`sheet-seg-btn${tab === "expenses" ? " active" : ""}`} onClick={() => setTab("expenses")}>Витрати</button>
        <button className={`sheet-seg-btn${tab === "income" ? " active" : ""}`} onClick={() => setTab("income")}>Надходження</button>
      </div>

      {tab === "expenses" ? (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <h3 style={{ margin: 0 }}>Категорії витрат</h3>
            <button
              className="btn-link"
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
              disabled={!refCycle || suggest.isPending}
              onClick={() => suggest.mutate()}
            >
              <Sparkles size={14} strokeWidth={2} />
              Запропонувати
            </button>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, margin: "0 0 12px" }}>
            Усі витрати — один піт (70% доходу). Ліміт (грн) — мʼякий план на цикл.
            «Резерв» — для грудкуватих рахунків (комуналка): оцінка знімається з пулу наперед
            і не рухає денний ліміт.
          </p>

          {expenses.map((c, i) => {
            const d = draftOf(c);
            return (
              <div key={c.id}>
                {i > 0 && <div style={{ height: 1, background: "var(--hairline)", margin: "8px 0" }} />}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 11, height: 11, borderRadius: 3, background: c.color ?? "#8a90a2", flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{c.name}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="—"
                    value={d.plannedUah}
                    onChange={(e) => setDraft(c.id, { plannedUah: e.target.value }, c)}
                    style={{ width: 82, textAlign: "right", fontSize: 14 }}
                  />
                  <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-muted)" }}>
                    <input
                      type="checkbox"
                      checked={d.reserveUpfront}
                      onChange={(e) => setDraft(c.id, { reserveUpfront: e.target.checked }, c)}
                    />
                    резерв
                  </label>
                  {confirmId === c.id ? (
                    <span className="cat-manager-confirm">
                      <button className="cat-del-yes" disabled={del.isPending} onClick={() => del.mutate(c.id)}>Видалити</button>
                      <button className="cat-del-no" onClick={() => setConfirmId(null)}>Ні</button>
                    </span>
                  ) : (
                    <button className="cat-del-btn" aria-label="Видалити" onClick={() => setConfirmId(c.id)}>
                      <Trash2 size={16} strokeWidth={2} />
                    </button>
                  )}
                </div>
                {notes[c.id] && <div style={{ fontSize: 12, color: "#FFB74D", marginTop: 3 }}>{notes[c.id]}</div>}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: "var(--text-dim)" }}>Сектор колеса</span>
                  <select
                    value={c.radialSlot ?? ""}
                    onChange={(e) => setSlot.mutate({ id: c.id, radialSlot: Number(e.target.value) })}
                    style={{
                      fontSize: 12,
                      padding: "2px 4px",
                      borderColor: c.radialSlot == null ? "#FFB74D" : undefined,
                    }}
                  >
                    <option value="" disabled>оберіть…</option>
                    {RADIAL_SLOTS.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
                  </select>
                  {c.radialSlot == null && (
                    <span style={{ fontSize: 11, color: "#FFB74D" }}>не на колесі — оберіть сектор</span>
                  )}
                </div>
              </div>
            );
          })}

          <button
            className="btn-primary"
            style={{ marginTop: 14 }}
            disabled={save.isPending || (Object.keys(drafts).length === 0 && !suggestedFor)}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Зберігаю…" : "Зберегти ліміти"}
          </button>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input
              placeholder="Нова категорія"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newName.trim() && newSlot !== null) create.mutate(); }}
              style={{ flex: 1, fontSize: 14 }}
            />
            {/* Сектор обов'язковий (див. коментар над newSlot): без нього
                категорія створилась би, але не мала б де зʼявитись на колесі. */}
            <select
              value={newSlot ?? ""}
              onChange={(e) => setNewSlot(e.target.value === "" ? null : Number(e.target.value))}
              style={{ fontSize: 13, width: 88 }}
            >
              <option value="" disabled>Сектор</option>
              {RADIAL_SLOTS.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
            </select>
            <button
              className="btn-link"
              style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, whiteSpace: "nowrap" }}
              disabled={!newName.trim() || newSlot === null || create.isPending}
              onClick={() => create.mutate()}
            >
              <Plus size={16} strokeWidth={2.4} />
              Додати
            </button>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "8px 0 0" }}>
            Видалення поверне транзакції цієї категорії в розбір.
          </p>
          {msg && <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>{msg}</div>}
        </>
      ) : (
        <>
          <h3 style={{ margin: "0 0 8px" }}>Надходження</h3>
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-dim)", margin: "0 0 12px" }}>
            Кожне надходження на карту чекає на вибір типу в Розгляді. Тип вирішує одне:
            створюються зобов'язання (частина грошей іде в інвестиції й цілі) — чи ні.
          </p>

          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--gold)", margin: "0 0 6px" }}>
            Створює зобов'язання
          </div>
          <ul style={{ margin: "0 0 14px", paddingLeft: 18, fontSize: 13, fontWeight: 600, color: "var(--text-dim)", lineHeight: 1.6 }}>
            <li><b style={{ color: "var(--text)" }}>💰 Зарплата</b> — дохід, ділиться 15% інвестиції / 15% цілі / 70% побут. Велика ЗП відкриває новий цикл.</li>
            <li><b style={{ color: "var(--text)" }}>📈 Інший дохід</b> — премія, підробіток, подарунок, продаж речей. Ділиться так само, цикл не відкриває.</li>
          </ul>

          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-dim)", margin: "0 0 6px" }}>
            Зобов'язань не створює
          </div>
          <ul style={{ margin: "0 0 14px", paddingLeft: 18, fontSize: 13, fontWeight: 600, color: "var(--text-dim)", lineHeight: 1.6 }}>
            <li><b style={{ color: "var(--text)" }}>↩️ Повернення грошей</b> — борг, повернення з магазину, компенсація. Це вже твої гроші: зменшує витрати побуту за цикл, тобто денний ліміт відновлюється.</li>
            <li><b style={{ color: "var(--text)" }}>💳 Кешбек і %</b> — бонус від банку. Так само зменшує витрати побуту.</li>
            <li><b style={{ color: "var(--text)" }}>🔁 Переказ між своїми</b> — зі своєї карти на свою. Визначається автоматично по рахунку, нічого не змінює.</li>
          </ul>

          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", margin: 0, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,.08)" }}>
            <b style={{ color: "var(--text)" }}>Конверт</b> — куди гроші йдуть із бюджету (побут / цілі / інвестиції).
            {" "}<b style={{ color: "var(--text)" }}>Категорія</b> — на що конкретно витрачено (продукти, кафе, транспорт).
            Це два незалежні виміри: витрата має і те, і те.
          </p>
        </>
      )}
    </div>
  );
}
