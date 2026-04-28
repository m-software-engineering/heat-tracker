# @m-software-engineering/heat-sdk

## 0.2.6

### Patch Changes

- Normalize invalid `batch.maxEvents` values to the default so auto-flush cannot get stuck on empty batches.
- Drain all queued batches during `flush()` and `shutdown()`, including queues larger than `maxEvents`.
- Isolate session and localStorage queue keys by project key and endpoint so multiple trackers can safely share a page.
- Update internal SDK payload version metadata to `0.2.6` to keep collector metadata aligned with the published package version.

## 0.2.5

### Patch Changes

- Capture click and move coordinates in page/document space (including scroll offsets) so heatmaps remain accurate after scrolling.
- Keep move/click coordinate semantics aligned with collector rendering updates for long-page and below-the-fold interactions.
- Update internal SDK payload version metadata to `0.2.5` to keep collector metadata aligned with the published package version.

## 0.2.4

### Patch Changes

- Fix localStorage queue persistence so successfully delivered events are removed from storage, preventing replay of already-sent batches after page reloads.
- Ensure persisted queue snapshots stay aligned with in-memory queue trimming when `maxQueueBytes` is enforced.
- Update internal SDK payload version metadata to `0.2.4` to keep collector metadata aligned with the published package version.

## 0.2.3

### Patch Changes

- Fix `shutdown()` to flush queued events before stopping, preventing event loss when applications close the tracker quickly.
- Restore patched `history.pushState` and `history.replaceState` methods during shutdown to avoid leaking SDK wrappers across tracker lifecycles.
- Update internal SDK payload version metadata to `0.2.3` so collector metadata remains aligned with the published package version.

## 0.2.2

### Patch Changes

- Fix published entrypoints for CommonJS and ESM consumers (`main`, `module`, and `exports`) so runtime imports resolve correctly from npm packages.
- Update internal SDK version metadata to `0.2.2` so collector payload metadata matches the published package version.

## 0.2.1

### Patch Changes

- Atualiza a documentação geral e dos pacotes, incluindo setup de integração com NestJS no collector.
  Também corrige a versão reportada internamente pelo SDK para ficar alinhada ao pacote publicado.

## 0.2.0

### Minor Changes

- Add package-level READMEs with usage snippets for common frameworks.
