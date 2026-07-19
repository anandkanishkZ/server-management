import { useSyncExternalStore } from "react";

interface ConfirmOptions {
  danger?: boolean;
  confirmLabel?: string;
  /** If set, the confirm button stays disabled until the user types this exact string. */
  typeToConfirm?: string;
}

interface PromptOptions {
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
}

export type DialogState =
  | ({ kind: "confirm"; id: string; message: string; resolve: (v: boolean) => void } & ConfirmOptions)
  | ({ kind: "prompt"; id: string; message: string; resolve: (v: string | null) => void } & PromptOptions);

let current: DialogState | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function confirmDialog(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    current = { kind: "confirm", id: Math.random().toString(36).slice(2), message, resolve, ...opts };
    notify();
  });
}

export function promptDialog(message: string, opts: PromptOptions = {}): Promise<string | null> {
  return new Promise((resolve) => {
    current = { kind: "prompt", id: Math.random().toString(36).slice(2), message, resolve, ...opts };
    notify();
  });
}

export function resolveDialog(value: boolean | string | null) {
  if (!current) return;
  current.resolve(value as never);
  current = null;
  notify();
}

export function useDialogState(): DialogState | null {
  return useSyncExternalStore(subscribe, () => current);
}
