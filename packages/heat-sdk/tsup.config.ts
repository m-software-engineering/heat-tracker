import { defineConfig } from "tsup";
import { version } from "./package.json";

// Single source for the SDK version reported in every batch (#184, #185): package.json.
export default defineConfig({ define: { __HEAT_SDK_VERSION__: JSON.stringify(version) } });
