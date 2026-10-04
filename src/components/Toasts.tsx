import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, Check, X } from "lucide-react";
import "./Toasts.css";

interface Toast {
  id: number;
  kind: "success" | "error";
  message: string;
}

interface Toaster {
  success(message: string): void;
  error(message: string): void;
}

const ToastContext = createContext<Toaster>({ success() {}, error() {} });
export const useToast = () => useContext(ToastContext);

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (kind: Toast["kind"], message: string) => {
      const id = ++counter;
      setToasts((all) => [...all.filter((t) => t.message !== message), { id, kind, message }].slice(-4));
      // Errors stay until dismissed; they usually need reading.
      if (kind === "success") setTimeout(() => dismiss(id), 2600);
    },
    [dismiss],
  );
  const toaster = useMemo(
    () => ({ success: (m: string) => push("success", m), error: (m: string) => push("error", m) }),
    [push],
  );
  return (
    <ToastContext.Provider value={toaster}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
            {t.kind === "error" ? <AlertCircle size={15} /> : <Check size={15} />}
            <span className="selectable">{t.message}</span>
            <button aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
