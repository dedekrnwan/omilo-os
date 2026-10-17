"use client";
import { useEffect, useState } from "react";
import { WfBlock, api } from "@/lib/api";

let cache: Promise<Record<string, WfBlock>> | null = null;

/** The workflow blocks (triggers, apps, data, logic, AI), loaded once per page. */
export function useBlocks() {
  const [blocks, setBlocks] = useState<Record<string, WfBlock>>({});
  useEffect(() => {
    cache ||= api<WfBlock[]>("/workflows/blocks").then((l) => Object.fromEntries(l.map((b) => [b.type, b])));
    cache.then(setBlocks).catch(() => { cache = null; });
  }, []);
  return blocks;
}
