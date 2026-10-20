const path = require("node:path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained server for the Docker image (examples/nextjs-dashboard/Dockerfile).
  output: "standalone",
  // Trace workspace packages (heat-errors) from the monorepo root.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  reactStrictMode: true
};

module.exports = nextConfig;
