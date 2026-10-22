/**
 * streamSSE — POST a JSON body to a Server-Sent Events endpoint and call
 * `onEvent` for every parsed event frame.
 *
 * The stream uses `fetch` + `ReadableStream` because `EventSource` is GET-only.
 * Each SSE frame is separated by `\n\n`.  Within a frame, lines are either
 * `event: <name>` or `data: <json>`.
 */
export async function streamSSE(
  url: string,
  body: unknown,
  onEvent: (event: string, data: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Omilo": "1" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {}
    throw new Error(msg);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const processFrame = (frame: string) => {
    let eventName = "message";
    let dataStr = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataStr = line.slice(5).trim();
      }
    }
    if (!dataStr) return;
    try {
      onEvent(eventName, JSON.parse(dataStr));
    } catch {
      onEvent(eventName, dataStr);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // SSE frames are separated by double newline
    const frames = buf.split("\n\n");
    // last element may be an incomplete frame — keep it in buf
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      if (frame.trim()) processFrame(frame);
    }
  }
  // flush remaining buffer
  if (buf.trim()) processFrame(buf);
}
