import { useEffect, useState } from "react";
import { resolveDialog, useDialogState } from "../lib/dialogs";
import "./DialogHost.css";

export default function DialogHost() {
  const dialog = useDialogState();
  const [value, setValue] = useState("");

  useEffect(() => {
    if (dialog?.kind === "prompt") setValue(dialog.defaultValue ?? "");
    else setValue("");
  }, [dialog?.id]);

  if (!dialog) return null;

  const isConfirm = dialog.kind === "confirm";
  const typeToConfirm = isConfirm ? dialog.typeToConfirm : undefined;
  const confirmDisabled = isConfirm && typeToConfirm !== undefined && value !== typeToConfirm;

  function handleCancel() {
    resolveDialog(isConfirm ? false : null);
  }

  function handleConfirm() {
    if (confirmDisabled) return;
    resolveDialog(isConfirm ? true : value);
  }

  return (
    <div className="dialog-overlay" onMouseDown={handleCancel}>
      <div className="dialog-box" onMouseDown={(e) => e.stopPropagation()}>
        <p className="dialog-message">{dialog.message}</p>

        {dialog.kind === "prompt" && (
          <input
            autoFocus
            className="dialog-input"
            value={value}
            placeholder={dialog.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirm();
              if (e.key === "Escape") handleCancel();
            }}
          />
        )}

        {typeToConfirm !== undefined && (
          <input
            autoFocus
            className="dialog-input dialog-input-mono"
            value={value}
            placeholder={typeToConfirm}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirm();
              if (e.key === "Escape") handleCancel();
            }}
          />
        )}

        <div className="dialog-actions">
          <button className="btn" onClick={handleCancel}>
            Cancel
          </button>
          <button
            className={`btn ${isConfirm && dialog.danger ? "btn-danger-solid" : "btn-primary"}`}
            onClick={handleConfirm}
            disabled={confirmDisabled}
          >
            {dialog.confirmLabel ?? (isConfirm ? "Confirm" : "OK")}
          </button>
        </div>
      </div>
    </div>
  );
}
