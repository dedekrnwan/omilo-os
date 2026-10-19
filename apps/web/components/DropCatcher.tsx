"use client";
import { useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { Staff } from "@/lib/api";

export default function DropCatcher({
  onFiles,
  disabled: _disabled,
  chief,
  children,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  chief?: Staff;
  children: React.ReactNode;
}) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  const hasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes("Files");

  const onDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current++;
    setActive(true);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (hasFiles(e)) e.preventDefault();
  };

  const onDragLeave = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    depth.current--;
    if (depth.current <= 0) {
      depth.current = 0;
      setActive(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current = 0;
    setActive(false);
    onFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <div
      className="dropcatch"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      {active && (
        <div className="dropcatch-overlay" aria-hidden>
          <div className="dropcatch-ring">
            <div className="dropcatch-tiles" aria-hidden>
              <div className="dropcatch-tile" style={{ "--dc-i": 0 } as React.CSSProperties} />
              <div className="dropcatch-tile" style={{ "--dc-i": 1 } as React.CSSProperties} />
              <div className="dropcatch-tile" style={{ "--dc-i": 2 } as React.CSSProperties} />
            </div>
            <div className="dropcatch-mascot">
              <Avatar who={chief ?? null} size={64} />
            </div>
            <p className="dropcatch-label">Drop — I&apos;ve got them!</p>
          </div>
        </div>
      )}
    </div>
  );
}
