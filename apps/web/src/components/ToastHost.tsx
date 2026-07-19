import { dismissToast, useToasts } from "../lib/toast";
import "./ToastHost.css";

const ICON: Record<string, string> = { success: "✓", error: "✕", info: "ℹ" };

export default function ToastHost() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;

  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`} onClick={() => dismissToast(t.id)}>
          <span className="toast-icon">{ICON[t.type]}</span>
          <span className="toast-message">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
