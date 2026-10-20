# Next.js Dashboard Example

Reference dashboard built with Next.js that consumes collector query APIs and draws the click heatmap over your live page.

## Quick setup

```bash
pnpm --filter ./examples/nextjs-dashboard dev
```

## How to use

1. Start a collector instance.
2. Open the dashboard.
3. Configure Collector Base URL and Project ID in the top controls.
4. Set Site URL (your site's origin, e.g. `https://shop.example.com`) and Path. The page loads in a sandboxed frame at the recorded viewport width and the heatmap fades in over it.

## Heatmap over the page

- Controls: viewport (desktop/tablet/mobile; each shows its event count, e.g. `Mobile · 312`, filters the map to the whole class, i.e. all its stored buckets, with the frame at the busiest bucket's width, and is disabled when empty, with the reason exposed to screen readers via `aria-describedby`), opacity, show/hide, Table, period (default last 7 days). They are kept in the URL, so a link reproduces the view.
- Keyboard: `H` toggles the heatmap and `[` / `]` change the opacity.
- "Top clicked areas" (area, clicks, % of total) is the text alternative. Screen readers always have it, and the Table toggle shows it.
- Colors use the viridis palette, which stays readable with common color-vision deficiencies. The legend shows the click count scale.
- If your site forbids framing (`X-Frame-Options` or CSP `frame-ancestors`), the dashboard shows `HEAT_E_FRAME_BLOCKED` and draws the heatmap on a blank canvas. To allow it, send `Content-Security-Policy: frame-ancestors 'self' <dashboard origin>` from your site.
- Known limits (M1): logged-in pages render their logged-out view, and content that changed since the clicks were recorded can misalign, because the map is coordinate-based. `app/api/frame-check` fetches the page from the dashboard server to read its framing headers. It only fetches origins listed in `HEAT_DASHBOARD_SITE_ORIGINS` (comma-separated full origins, e.g. `https://shop.example.com,https://www.example.com`). Wildcards (`*`, `*.example.com`) are not supported; list each origin. Entries that are not origins (`example.com`, a URL with a path) are ignored with a `HEAT_E_FRAME_ORIGIN_INVALID` warning in the server log. Redirects are followed only within the allowlist (at most 5). For other origins the page is not loaded at all: the dashboard shows "This site isn't allowed yet" (`HEAT_E_FRAME_ORIGIN_NOT_ALLOWED`) with the `HEAT_DASHBOARD_SITE_ORIGINS=<origin>` line to copy, and the heatmap on a blank canvas. If the site does not answer the check within 2.5 s or cannot be reached from the dashboard server, the page is loaded anyway (the browser still enforces framing) with the notice "We couldn't check whether this site allows framing. If the page stays blank, the site likely blocks it." (`HEAT_E_FRAME_CHECK_INCONCLUSIVE`); if it has not loaded within 8 s, the dashboard shows `HEAT_E_FRAME_BLOCKED`. If the frame-check route itself gives no answer within 3 s (or fails), or a redirect chain is invalid, the page is not loaded: the dashboard shows `HEAT_E_FRAME_CHECK_UNVERIFIED` and the heatmap on a blank canvas.
- A container narrower than the recorded viewport scales the page to fit (no horizontal scroll); the label always names the frame width (`400 px`) and adds the scale when reduced (`1280 px, 80%`). Clicks stored without a position are counted in a note (`12 clicks without a position aren't shown`).
