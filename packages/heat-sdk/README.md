# @m-software-engineering/heat-sdk

Browser SDK for capturing session events and generating heatmaps with the heat-tracker collector.

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

## Framework snippets

### React (useEffect)

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

### Angular (app.component.ts)

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

## API

### init(config)

Creates a tracker instance.

Required:
- `endpoint`: Full URL to the collector ingest endpoint (e.g. `/ingest`).
- `projectKey`: The project key used by the collector.

Optional:
- `app`, `session`, `batch`, `sampling`, `privacy`, `capture`

### tracker methods

- `identify(userId, traits?)`
- `setAuthToken(jwt | null)`
- `track(name, props?)`
- `flush()`
- `shutdown()`

## Notes

- This SDK is intended for browsers. Calling `init` on the server will throw.
- When using JWT auth, call `setAuthToken` to attach the token to ingest requests.
