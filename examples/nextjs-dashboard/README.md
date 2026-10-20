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

- Controls: viewport (desktop/tablet/mobile), opacity, show/hide, Table, period (default last 7 days). They are kept in the URL, so a link reproduces the view.
- Keyboard: `H` toggles the heatmap and `[` / `]` change the opacity.
- "Top clicked areas" (area, clicks, % of total) is the text alternative. Screen readers always have it, and the Table toggle shows it.
- Colors use the viridis palette, which stays readable with common color-vision deficiencies. The legend shows the click count scale.
- If your site forbids framing (`X-Frame-Options` or CSP `frame-ancestors`), the dashboard shows `HEAT_E_FRAME_BLOCKED` and draws the heatmap on a blank canvas. To allow it, send `Content-Security-Policy: frame-ancestors 'self' <dashboard origin>` from your site.
- Known limits (M1): logged-in pages render their logged-out view, and content that changed since the clicks were recorded can misalign, because the map is coordinate-based. `app/api/frame-check` fetches the page from the dashboard server to read its framing headers, so expose the dashboard only to trusted users.
