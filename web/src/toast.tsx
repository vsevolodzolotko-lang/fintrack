import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// Тост із відкладеною дією. Видалення НЕ виконується одразу: рядок зникає з
// екрана, а запит на сервер іде лише коли тост догорів. «Скасувати» просто
// гасить таймер — на сервер не летить нічого.
//
// Так надійніше за «видалити й відновити»: там існує вікно, у якому сервер уже
// втратив рядок, і відновлення може не спрацювати. А це вручну занесені дані,
// відновити які можна лише згадавши цифру. Ціна: закрив апку за 5 секунд —
// видалення не сталося взагалі. Напрямок помилки безпечний.

const DURATION_MS = 5000;

interface ToastRequest {
  text: string;
  actionLabel: string;
  onAction: () => void;
  onExpire: () => void;
}

interface ToastApi {
  showToast: (t: ToastRequest) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast поза ToastProvider");
  return v;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastRequest | null>(null);
  const timer = useRef<number | null>(null);
  // Дзеркалить toast, але поза React-стейтом: showToast читає й пише його
  // синхронно, тоді як setState-апдейтер має лишатись чистим — виклик
  // prev.onExpire() (мутація на сервер) усередині нього порушував це, і під
  // накопиченими лейнами React 18 (напр. видалення B, поки тост A ще висить)
  // міг спрацювати двічі під StrictMode.
  const current = useRef<ToastRequest | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const showToast = useCallback((t: ToastRequest) => {
    // Один тост за раз: якщо попередній ще висить, його відкладена дія
    // виконується негайно, інакше вона загубилась би мовчки. Флаш — поза
    // апдейтером setState, див. коментар біля `current` вище.
    const prev = current.current;
    if (prev) {
      clear();
      prev.onExpire();
    }
    current.current = t;
    setToast(t);
  }, [clear]);

  useEffect(() => {
    if (!toast) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      current.current = null;
      setToast(null);
      toast.onExpire();
    }, DURATION_MS);
    return clear;
  }, [toast, clear]);

  const undo = () => {
    clear();
    const t = toast;
    current.current = null;
    setToast(null);
    t?.onAction();
  };

  return (
    <Ctx.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div className="toast">
          <span className="toast-text">{toast.text}</span>
          <button className="toast-action" onClick={undo}>{toast.actionLabel}</button>
        </div>
      )}
    </Ctx.Provider>
  );
}
