# @m-software-engineering/heat-collector

## 0.3.6

### Patch Changes

- Assign request IDs before JSON parsing and return structured `invalid_json` / `payload_too_large` responses for parser errors.
- Scope rate-limit buckets to each collector instance and prune expired buckets to avoid cross-instance leakage in embedded hosts.
- Revalidate `hooks.onBeforeInsert` output before persistence so invalid hook transforms return structured client errors.
- Apply session `path` filtering before pagination in both SQL and MongoDB session queries.

## 0.3.5

### Patch Changes

- Improve heatmap Y-axis projection by scaling render height with observed interaction depth, reducing below-the-fold compression.
- Project scroll heatmap points using normalized scroll depth over the active render height for more consistent long-page hotspots.
- Document and align heatmap diagnostics with the latest SDK coordinate capture behavior.

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
