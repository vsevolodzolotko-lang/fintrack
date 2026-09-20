import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { LogOut, RefreshCw, Trash2, Download } from "lucide-react";
import { api, type AppSettings } from "../api";
import { useAuth } from "../auth";
import { PullToRefresh } from "../components/PullToRefresh";
import { CategoriesBlock } from "../components/CategoriesBlock";

interface Token { id: string; clientName: string | null; lastPolledAt: string | null }

export function Settings() {
  const { logout } = useAuth();
  const qc = useQueryClient();
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState("");

  const { data: tokens } = useQuery({ queryKey: ["tokens"], queryFn: () => api.get<Token[]>("/mono/tokens") });

  const addToken = useMutation({
    mutationFn: () => api.post<{ webHookUrl: string; clientName: string }>("/mono/tokens", { token }),
    onSuccess: (r) => {
      setToken("");
      setMsg(`Додано: ${r.clientName}. Webhook: ${r.webHookUrl}`);
      qc.invalidateQueries({ queryKey: ["tokens"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => setMsg((e as Error).message),
  });

  const delToken = useMutation({
    mutationFn: (id: string) => api.del(`/mono/tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tokens"] }),
  });

  const poll = useMutation({
    mutationFn: () => api.post("/mono/poll"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setMsg("Рахунки оновлено");
    },
  });

  const syncHistory = useMutation({
    mutationFn: (days: number) => api.post("/mono/sync-history", { days }),
    onSuccess: () => {
      setMsg("Синхронізацію запущено. Транзакції з'являться протягом кількох хвилин (Mono rate limit).");
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["dashboard"] });
        qc.invalidateQueries({ queryKey: ["txs"] });
      }, 5000);
    },
  });

  const [salaryDay, setSalaryDay] = useState("");
  const [salaryMsg, setSalaryMsg] = useState("");
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.get<AppSettings>("/settings") });
  useEffect(() => {
    if (settings) setSalaryDay(settings.salaryDayOfMonth?.toString() ?? "");
  }, [settings]);

  const saveSalaryDay = useMutation({
    mutationFn: (day: number | null) => api.patch<AppSettings>("/settings", { salaryDayOfMonth: day }),
    onSuccess: () => {
      setSalaryMsg("Збережено. Денний ліміт перераховано.");
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => setSalaryMsg((e as Error).message),
  });
  const salaryDayNum = salaryDay === "" ? null : Number(salaryDay);
  const salaryDayValid = salaryDayNum === null || (Number.isInteger(salaryDayNum) && salaryDayNum >= 1 && salaryDayNum <= 31);

  const { data: dash } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<import("../api").Dashboard>("/dashboard") });
  const saveGoalsAccount = useMutation({
    mutationFn: (goalsAccountId: string | null) => api.patch<AppSettings>("/settings", { goalsAccountId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["goals"] });
    },
  });

  return (
    <PullToRefresh>
    <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 16 }}>
      <div className="section-h" style={{ margin: "16px 0 12px" }}>
        <h2>Налаштування</h2>
      </div>

      <div className="card">
        <h3>Monobank токен</h3>
        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, margin: "0 0 12px" }}>
          Отримайте персональний токен на <strong>api.monobank.ua</strong> і вставте сюди.
          Токен шифрується AES-256-GCM та реєструється webhook.
        </p>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="uXXXX..."
          style={{ fontFamily: "monospace", fontSize: 13 }}
        />
        <button
          className="btn-primary"
          style={{ marginTop: 12 }}
          disabled={!token || addToken.isPending}
          onClick={() => addToken.mutate()}
        >
          {addToken.isPending ? "Перевірка…" : "Додати токен"}
        </button>
        {msg && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, wordBreak: "break-all" }}>
            {msg}
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Підключені токени</h3>
          <button
            className="btn-link"
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
            onClick={() => poll.mutate()}
            disabled={poll.isPending}
          >
            <RefreshCw size={14} strokeWidth={2} />
            Оновити
          </button>
        </div>
        {tokens?.length === 0 && (
          <p style={{ color: "var(--text-dim)", fontSize: 13, margin: 0 }}>Немає підключених токенів</p>
        )}
        {tokens?.map((t, i) => (
          <div key={t.id}>
            {i > 0 && <div style={{ height: 1, background: "var(--hairline)", margin: "8px 0" }} />}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{t.clientName ?? t.id}</div>
                {t.lastPolledAt && (
                  <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>
                    Оновлено: {new Date(t.lastPolledAt).toLocaleString("uk-UA", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}
                  </div>
                )}
              </div>
              <button
                className="btn-link"
                style={{ color: "var(--expense)", display: "flex", alignItems: "center" }}
                onClick={() => delToken.mutate(t.id)}
              >
                <Trash2 size={16} strokeWidth={2} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Цикл</h3>
        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, margin: "0 0 4px" }}>
          День місяця, коли зазвичай приходить зарплата. Використовується для оцінки
          «Залишилось N дн.» і денного ліміту, поки не прийшла реальна ЗП.
        </p>
        <label>День зарплати (1–31, порожньо — без оцінки)</label>
        <input
          type="number"
          min={1}
          max={31}
          value={salaryDay}
          onChange={(e) => setSalaryDay(e.target.value)}
          placeholder="напр. 26"
          style={{ width: 120 }}
        />
        <button
          className="btn-primary"
          style={{ marginTop: 12 }}
          disabled={!salaryDayValid || saveSalaryDay.isPending}
          onClick={() => saveSalaryDay.mutate(salaryDayNum)}
        >
          {saveSalaryDay.isPending ? "Збереження…" : "Зберегти"}
        </button>
        {!salaryDayValid && (
          <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--expense)" }}>Число від 1 до 31</div>
        )}
        {salaryMsg && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>{salaryMsg}</div>
        )}
      </div>

      <div className="card">
        <h3>Цілі</h3>
        <label className="field-label">Рахунок-контейнер (біла картка)</label>
        <select
          value={settings?.goalsAccountId ?? ""}
          onChange={(e) => saveGoalsAccount.mutate(e.target.value || null)}
        >
          <option value="">— не обрано —</option>
          {dash?.accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.title}</option>
          ))}
        </select>
        <p className="hint">Окремий рахунок Monobank під накопичення. Його баланс стає джерелом правди для цілей.</p>
      </div>

      <div className="card">
        <h3>Імпорт виписки</h3>
        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, margin: "0 0 12px" }}>
          Завантажити транзакції за останній місяць з Monobank. Через rate limit (~4 хв на 4 рахунки).
        </p>
        <button
          className="btn-primary"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          disabled={syncHistory.isPending}
          onClick={() => syncHistory.mutate(30)}
        >
          <Download size={16} strokeWidth={2} />
          {syncHistory.isPending ? "Запущено…" : "Завантажити виписку (30 днів)"}
        </button>
      </div>

      <CategoriesBlock />

      <div className="card">
        <button
          onClick={() => logout()}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            background: "none", border: "1px solid rgba(239,83,80,.3)", borderRadius: 12,
            width: "100%", padding: "13px 20px",
            color: "var(--expense)", fontSize: 15, fontWeight: 700,
          }}
        >
          <LogOut size={18} strokeWidth={2} />
          Вийти з акаунту
        </button>
      </div>
    </div>
    </PullToRefresh>
  );
}
