"use client";
import type { ReactNode } from "react";

/* Confirmation and notice dialogs, shown by <DialogHost /> (mounted once in the app layout). They replace the
   browser's confirm() and alert(): `if (!(await confirmDialog({ title: "Stop this job?" }))) return;` */

export type DialogWho = { id: string; name?: string; role?: string; is_chief?: boolean };
export type DialogOpts = {
  title: string;
  body?: ReactNode;
  confirm?: string;        // the main button
  cancel?: string;         // the other button ("Cancel", "Keep Marketing")
  danger?: boolean;        // red main button; Enter does not confirm, Cancel has the focus
  who?: DialogWho | null;  // the helper this is about: shown with a sad (danger) or worried face
  mood?: "sad" | "worried" | "happy";
  icon?: string;           // shown instead of a mascot when nothing is about a helper
  alert?: boolean;         // one button only
};
export type DialogReq = DialogOpts & { id: number; resolve: (ok: boolean) => void };

let n = 0;
export function confirmDialog(o: DialogOpts): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent<DialogReq>("omilo:dialog", { detail: { ...o, id: ++n, resolve } })));
}
export function alertDialog(o: Omit<DialogOpts, "alert" | "danger" | "cancel">): Promise<void> {
  return confirmDialog({ confirm: "OK", ...o, alert: true }).then(() => undefined);
}
