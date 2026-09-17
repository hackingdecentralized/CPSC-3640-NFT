/** Small shared pieces for the generated inspection pages. */
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]!);

export const PAGE_STYLE = `
  :root { --bg:#17171e; --panel:#211f28; --line:#35313f; --text:#f6efe4; --muted:#a99e8c; --gold:#e8b64f; --teal:#7fd3a8; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif; }
  main { max-width:1400px; margin:0 auto; padding:32px 24px 64px; }
  h1 { margin:0 0 4px; font-size:24px; }
  h2 { margin:40px 0 12px; font-size:18px; color:var(--gold); }
  p.lede { margin:0 0 24px; color:var(--muted); }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:18px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  .card img { display:block; width:100%; height:auto; background:#000; }
  .card .body { padding:12px 14px 14px; }
  .card h3 { margin:0 0 2px; font-size:15px; }
  .muted { color:var(--muted); }
  code, .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
  table { width:100%; border-collapse:collapse; margin-top:8px; font-size:12.5px; }
  td { padding:3px 0; border-top:1px solid var(--line); vertical-align:top; }
  td:first-child { color:var(--muted); width:42%; }
  .pill { display:inline-block; padding:1px 8px; border-radius:999px; border:1px solid var(--line); font-size:12px; margin:2px 4px 2px 0; }
  .pill.rare { border-color:var(--gold); color:var(--gold); }
`;

export const page = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head><body><main>${body}</main></body></html>\n`;

/** Run `task` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!, index);
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
  return results;
}
