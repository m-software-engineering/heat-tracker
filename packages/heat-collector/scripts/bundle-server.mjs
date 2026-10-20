// Bundles the `heat-collector` server (src/server.ts) and its pure-JS dependencies (express,
// drizzle, zod, heat-errors, pg, mysql2, mongodb) into one CommonJS file for the Docker image,
// so the runtime stage needs no node_modules. Native or optional drivers stay external:
// SQLite (better-sqlite3) is not available in the image; use Postgres, MySQL or MongoDB.
import { build } from "tsup";

await build({
  entry: { server: "src/server.ts" },
  outDir: process.argv[2] || "dist-server",
  format: ["cjs"],
  platform: "node",
  target: "node22",
  clean: true,
  dts: false,
  minify: false,
  config: false,
  noExternal: [/.*/],
  external: [
    "better-sqlite3",
    "pg-native",
    "@aws-sdk/credential-providers",
    "@mongodb-js/zstd",
    "gcp-metadata",
    "kerberos",
    "mongodb-client-encryption",
    "snappy",
    "socks",
    "aws4"
  ]
});
