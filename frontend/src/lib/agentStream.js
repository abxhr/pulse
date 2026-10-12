// NDJSON reader for POST /api/agent/chat. Calls onEvent for every complete line, tolerating chunk
// boundaries that split a line (or a UTF-8 character) in half.
export function createLineParser(onEvent) {
  let buf = "";
  return {
    push(text) {
      buf += text;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try { onEvent(JSON.parse(line)); } catch { /* a malformed line must not kill the stream */ }
      }
    },
    flush() { if (buf.trim()) this.push("\n"); },
  };
}

export async function streamChat({ message, page, provider }, onEvent, signal) {
  const res = await fetch("/api/agent/chat", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ message, page, provider }),
  });
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("pulse:unauthorized"));
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message || `Request failed (${res.status})`);
  }
  const parser = createLineParser(onEvent);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.flush();
}

/** Fold a stream event into an ordered list of blocks (text deltas extend the last text block). */
export function applyEvent(blocks, ev) {
  if (ev.t === "text") {
    const last = blocks[blocks.length - 1];
    return last?.type === "text"
      ? [...blocks.slice(0, -1), { ...last, text: last.text + ev.d }]
      : [...blocks, { type: "text", text: ev.d }];
  }
  if (ev.t === "block") return [...blocks, ev.b];
  return blocks;
}
