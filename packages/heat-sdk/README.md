# @m-software-engineering/heat-sdk

SDK browser para capturar comportamento de navegação e enviar eventos ao heat-collector.

## Instalação

```bash
npm install @m-software-engineering/heat-sdk
# ou
pnpm add @m-software-engineering/heat-sdk
# ou
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

## Eventos capturados

- `click`
- `move` (com throttle)
- `scroll`
- `pageview`
- `custom` (via `track`)
- `input` (opcional)
- `keyboard` (opcional)

## API principal

### `init(config)`

Cria e inicia o tracker no browser.

Campos obrigatórios:

- `endpoint`: URL completa de ingestão (`.../ingest`)
- `projectKey`: chave do projeto

Campos opcionais:

- `app`: nome/versão/ambiente
- `session`: persistência (`tab` ou `browser`) e timeout de inatividade
- `batch`: limites de lote e estratégia de fila
- `sampling`: taxa de amostragem (0..1)
- `privacy`: bloqueios e mascaramento por seletor
- `capture`: granularidade dos capturadores

### Métodos do tracker

- `identify(userId, traits?)`
- `setAuthToken(jwt | null)`
- `track(name, props?)`
- `flush()`
- `shutdown()`

## Exemplos de framework

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

## Privacidade e segurança

- Funciona apenas em ambiente browser (chamar no servidor lança erro).
- `Do Not Track` é respeitado por padrão.
- Captura de input/teclado vem desativada por padrão.
- Campos sensíveis são bloqueados por seletores padrão.

## JWT no collector

Se o collector usar `auth.mode = "jwt"` ou `"both"`, anexe token por sessão:

```ts
tracker.setAuthToken("<jwt>");
```
