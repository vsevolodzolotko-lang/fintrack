import { useState } from "react";
import { useAuth } from "../auth";

export function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setName] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password, displayName);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="center">
      <form className="auth-card" onSubmit={submit}>
        <h1>Gold Money</h1>
        <p className="auth-sub">{mode === "login" ? "Вхід до акаунту" : "Реєстрація"}</p>
        {mode === "register" && (
          <input placeholder="Імʼя" value={displayName} onChange={(e) => setName(e.target.value)} required />
        )}
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Пароль (мін. 8 символів)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        {err && <div style={{ fontSize: 13, color: "var(--expense)", fontWeight: 600 }}>{err}</div>}
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? "Завантаження…" : mode === "login" ? "Увійти" : "Зареєструватись"}
        </button>
        <button type="button" className="btn-link" style={{ textAlign: "center", fontSize: 14 }} onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "Створити акаунт" : "Вже маю акаунт"}
        </button>
      </form>
    </div>
  );
}
