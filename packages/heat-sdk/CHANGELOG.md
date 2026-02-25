# @m-software-engineering/heat-sdk

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
