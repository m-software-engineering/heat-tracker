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
