export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface LayoutOptions {
  title: string;
  app: string;
  body: string;
}

/**
 * Every mock page is server-rendered with real, semantic HTML.
 *
 * No framework and no client-side rendering: the automation engine resolves
 * targets through the accessibility tree, so the pages have to expose honest
 * roles and names rather than a div soup that only looks right in a screenshot.
 */
export function layout({ title, app, body }: LayoutOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; background: #f6f7f9; color: #14161a; }
  header { background: #1f2933; color: #fff; padding: 12px 24px; display: flex; gap: 16px; align-items: baseline; }
  header .brand { font-weight: 600; letter-spacing: .01em; }
  header .app { font-size: 12px; opacity: .7; text-transform: uppercase; letter-spacing: .08em; }
  main { max-width: 820px; margin: 24px auto; background: #fff; border: 1px solid #dde1e6; border-radius: 10px; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  button { font: inherit; padding: 8px 14px; border-radius: 6px; border: 1px solid #1f2933; background: #1f2933; color: #fff; cursor: pointer; }
  button.secondary { background: #fff; color: #1f2933; }
  input, textarea { font: inherit; padding: 8px 10px; border: 1px solid #c4c9d0; border-radius: 6px; width: 100%; box-sizing: border-box; }
  label { display: block; font-weight: 600; margin: 16px 0 4px; }
  dl { display: grid; grid-template-columns: 140px 1fr; gap: 4px 12px; margin: 0 0 16px; }
  dt { font-weight: 600; color: #52606d; }
  dd { margin: 0; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { border-bottom: 1px solid #eceff1; padding: 12px 0; display: flex; justify-content: space-between; gap: 16px; }
  .muted { color: #7b8794; font-size: 13px; }
  .message { border: 1px solid #e4e7eb; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; background: #fbfcfd; }
  form.inline { display: flex; gap: 8px; align-items: flex-end; }
  form.inline > div { flex: 1; }
  code { background: #eef1f4; padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
<header><span class="brand">${escapeHtml(title)}</span><span class="app" data-testid="app-name">${escapeHtml(app)}</span></header>
<main>${body}</main>
</body>
</html>`;
}
