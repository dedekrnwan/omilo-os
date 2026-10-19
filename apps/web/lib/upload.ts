"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import type { Attached } from "@/components/ComposerTools";

const toB64 = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] || "");
  r.onerror = rej;
  r.readAsDataURL(f);
});

export function useFileUpload(
  files: Attached[],
  setFiles: (f: Attached[]) => void,
): { upload: (list: FileList | File[] | null) => Promise<void>; uploading: boolean; err: string | null } {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const upload = async (list: FileList | File[] | null) => {
    if (!list || !Array.from(list).length) return;
    setUploading(true); setErr(null);
    const added: Attached[] = [];
    try {
      for (const f of Array.from(list).slice(0, 10)) {
        if (f.size > 25 * 1024 * 1024) { setErr(`${f.name} is larger than 25 MB`); continue; }
        added.push(await api<Attached>("/files", { body: { name: f.name, data: await toB64(f) } }));
      }
    } catch (e: any) { setErr(e.message); }
    setFiles([...files, ...added]);
    setUploading(false);
  };

  return { upload, uploading, err };
}
