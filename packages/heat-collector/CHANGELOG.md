# @m-software-engineering/heat-collector

## 0.3.4

### Patch Changes

- Fix MongoDB heatmap empty-response troubleshooting by keeping backward-compatible default `type=click` and automatically falling back to `type=all` when no type is provided and click returns zero rows.
- Add richer heatmap diagnostics (`requestedType`, `resolvedType`, `plotted`, `ignored`, `typeBreakdown`) and a new raw events troubleshooting endpoint: `GET /api/projects/:projectId/events`.
- Improve REST API reliability with structured error payloads, consistent request correlation headers (`X-Request-Id`), rate-limit context headers, and request lifecycle logging.
- Make SQL session listing compatible with stricter SQL modes by removing non-portable grouped projections and computing `eventCount` safely per returned session.

## 0.3.3

### Patch Changes

- Publish a patch version bump to align release metadata with the latest monorepo bugfix deployment.

## 0.3.2

### Patch Changes

- Publish a maintenance release aligned with monorepo consistency updates and workspace type-check improvements.

## 0.3.1

### Patch Changes

- Atualiza a documentação geral e dos pacotes, incluindo setup de integração com NestJS no collector.
  Também corrige a versão reportada internamente pelo SDK para ficar alinhada ao pacote publicado.

## 0.3.0

### Minor Changes

- Fix package module type so tsup emits `dist/index.cjs` for CommonJS consumers (including NestJS `require` resolution).

## 0.2.0

### Minor Changes

- Add package-level READMEs with usage snippets for common frameworks.
