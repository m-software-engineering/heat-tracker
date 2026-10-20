# @m-software-engineering/heat-sdk

Browser SDK for heat-tracker. It captures user behavior events in the client and sends batched payloads to heat-collector.

## Install

```bash
npm install @m-software-engineering/heat-sdk
# or
pnpm add @m-software-engineering/heat-sdk
# or
yarn add @m-software-engineering/heat-sdk
```

## Quick start

```ts
import { init } from "@m-software-engineering/heat-sdk";

const tracker = init({
  endpoint: "https://collector.example.com/ingest",
  projectKey: "your-project-key"
});

tracker.track("signup", { plan: "pro" });
await tracker.flush();
```

## How it works

1. `init(config)` starts a browser tracker with session metadata.
2. Built-in listeners collect events such as clicks, movement, scrolling, and page views.
3. Events are queued and flushed in batches to the collector endpoint.
4. Optional methods (`identify`, `track`, `setAuthToken`) enrich and control payloads.
5. If you set `dashboardOrigins` (the dashboard's snippet fills it in) and the page is shown in a frame, `init` posts `{ type: "heat-tracker:frame-hello", href: origin + pathname }` to each listed origin, using that origin as the exact `targetOrigin` (never `*`), so the heat-tracker dashboard knows the page really loaded and where it ended up. The query string and hash are never sent. Without the option nothing is sent. This happens even when Do Not Track or sampling turns tracking off; the message carries no events.

## Coordinate model

- `click` and `move` coordinates are recorded in page/document space (`client + scroll offset`) instead of only viewport space.
- This makes heatmaps stable on long pages, nested layouts, and after user scrolling.
- `scroll` events continue to report depth as a percentage.

## Captured event types

- `click`
- `move` (throttled)
- `scroll`
- `pageview`
- `custom` (via `track`)
- `input` (optional)
- `keyboard` (optional)

## Main API

### `init(config)`

Creates and starts the tracker in the browser.

Required fields:

- `endpoint`: full ingestion URL (`.../ingest`)
- `projectKey`: project key

Optional fields:

- `app`: app name/version/environment
- `session`: persistence (`tab` or `browser`) and idle timeout
- `batch`: batch limits and queue strategy
- `sampling`: sampling rate (0..1)
- `privacy`: selector masking and blocking options
- `capture`: capture-level controls
- `onError(err)`: receives every ingest error as a `HeatError` (`code`, `message`, `cause`, `fix`, `docs`, `requestId?`)
- `debug`: logs each error code once per page load; the SDK is silent otherwise
- `dashboardOrigins`: origins of heat-tracker dashboards that may show this page in a frame, e.g. `["https://heat.example.com"]`. When framed, the SDK sends each of them only `origin + pathname` (never the query or hash), with that origin as the exact `postMessage` target. Omit it and nothing is sent. The dashboard's onboarding snippet fills it in.

`init()` throws a `HeatTrackerError` (`HEAT_E_CONFIG_MISSING`, `HEAT_E_NOT_BROWSER`). See [docs/errors.md](../../docs/errors.md).

### Tracker methods

- `identify(userId, traits?)`
- `setAuthToken(jwt | null)`
- `track(name, props?)`
- `flush()`
- `shutdown()`

## Framework examples

### React

```tsx
import { useEffect } from "react";
import { init } from "@m-software-engineering/heat-sdk";

export function App() {
  useEffect(() => {
    const tracker = init({
      endpoint: "https://collector.example.com/ingest",
      projectKey: "your-project-key"
    });

    return () => void tracker.shutdown();
  }, []);

  return <div>My App</div>;
}
```

### Angular

```ts
import { Component, OnDestroy, OnInit } from "@angular/core";
import { init, type Tracker } from "@m-software-engineering/heat-sdk";

@Component({ selector: "app-root", template: "<div>My App</div>" })
export class AppComponent implements OnInit, OnDestroy {
  private tracker?: Tracker;

  ngOnInit() {
    this.tracker = init({
      endpoint: "https://collector.example.com/ingest",
      projectKey: "your-project-key"
    });
  }

  ngOnDestroy() {
    void this.tracker?.shutdown();
  }
}
```

## Privacy and security defaults

- Browser-only runtime (throws if called on the server).
- Respects `Do Not Track` by default.
- Input and keyboard capture are disabled by default.
- Sensitive fields are blocked by default selector rules.

## JWT support with collector

If the collector uses `auth.mode = "jwt"` or `"both"`, attach a token per session:

```ts
tracker.setAuthToken("<jwt>");
```
