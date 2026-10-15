"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

/* Work now lives in the Workspace (toggle "Work"). Old links keep working. */
function Redirect() {
  const router = useRouter();
  const id = useSearchParams().get("id");
  useEffect(() => { router.replace(id ? `/chat/?view=work&task=${id}` : "/chat/?view=work"); }, [id, router]);
  return null;
}

export default function Work() {
  return <Suspense><Redirect /></Suspense>;
}
