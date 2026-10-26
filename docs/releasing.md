# Releasing

Releases run from `.github/workflows/cd.yml` with Changesets and npm trusted
publishing (OIDC, no `NPM_TOKEN`).

## Pre-publish guard

Before `changeset publish` runs, `scripts/check-npm-publishable.mjs` checks
every non-private workspace package whose local version is not on npm yet. It
fails the job (nothing is published) when:

- a package name does not exist on npm at all (trusted publishing cannot create
  a new package);
- a workspace package depends on such a missing package;
- the registry errors or times out (fail closed).

It only runs on the publish path: `node scripts/check-npm-publishable.mjs pending`
reproduces how changesets/action counts pending changesets (including pre mode,
where ids listed in `.changeset/pre.json` are ignored).

Known limit: the Trusted Publisher configuration is not readable through the
public registry API, so a package that exists but has no publisher configured is
still only caught at publish time.

## Publishing a new package

1. Publish the first version manually from a maintainer machine:
   `pnpm --filter <name> build && cd packages/<dir> && npm publish --access public`.
2. On npmjs.com, open the package settings and configure the Trusted Publisher
   (GitHub Actions, `m-software-engineering/heat-tracker`, workflow `cd.yml`).
3. Rerun the CD workflow.

## Deliberate override

If a release must proceed while a package is knowingly missing, set
`PREFLIGHT_ALLOW_MISSING` to a comma-separated list of exact package names on
the preflight step. Listed names are downgraded to warnings; any other missing
package still fails. Remove the override after the release.

## Container images

The `publish-images` job in `.github/workflows/cd.yml` builds and pushes
`ghcr.io/m-software-engineering/heat-collector:<version>` and
`ghcr.io/m-software-engineering/heat-dashboard:<version>`, where `<version>` is the
`@m-software-engineering/heat-collector` version.

- **When it runs:** after the `release` job, only when Changesets actually published
  (`published == 'true'`) and `@m-software-engineering/heat-collector` is among the
  published packages. Releases that don't include the collector produce no images.
- **Re-running for an existing release:** trigger the CD workflow manually
  (`workflow_dispatch`) with input `version`. It must equal the current
  `packages/heat-collector/package.json` version and that version must already be on npm;
  otherwise the run fails before building.
- **Skip if exists:** each image first runs `docker manifest inspect`; if the tag already
  exists in GHCR the push is skipped. Published tags are immutable by convention — never
  overwrite one.
- **Rollback:** don't retag or delete. Pin consumers (and `docker-compose.yml`) back to
  the previous version, then ship a fix as a new patch release so new images get built.
- **Compose sync:** `pnpm version-packages` (used by the Changesets action) runs
  `changeset version` followed by `node scripts/sync-compose-tag.mjs`, which rewrites the
  `heat-collector`/`heat-dashboard` tags in the root `docker-compose.yml` to the new
  collector version, so the Version Packages PR carries the compose bump.

### First publish

GHCR packages are created **private**. After the first successful run, once per image:

1. Open the package (Organization → Packages → `heat-collector` / `heat-dashboard`) →
   **Package settings**.
2. **Change visibility** → Public.
3. Under **Manage Actions access / Connect repository**, link
   `m-software-engineering/heat-tracker` (the `org.opencontainers.image.source` label
   usually does this automatically; confirm it).

Verify anonymous pulls work:

```sh
docker logout ghcr.io
docker pull ghcr.io/m-software-engineering/heat-collector:<version>
docker pull ghcr.io/m-software-engineering/heat-dashboard:<version>
```
