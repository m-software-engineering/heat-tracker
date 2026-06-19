import js from "@eslint/js";
import noUnsanitized from "eslint-plugin-no-unsanitized";
import security from "eslint-plugin-security";
import globals from "globals";
import tseslint from "typescript-eslint";

const tsFiles = ["**/*.{ts,tsx}"];
const jsFiles = ["**/*.{js,cjs,mjs}"];

export default tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/playwright-report/**",
      "**/temp/**",
      "**/test-results/**",
      "**/*.d.ts"
    ]
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off"
    }
  },
  {
    files: jsFiles,
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node
      }
    }
  },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: tsFiles
  })),
  {
    files: tsFiles,
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["packages/heat-sdk/vitest.config.ts", "packages/heat-collector/vitest.config.ts"]
        },
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      security,
      "no-unsanitized": noUnsanitized
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: {
            arguments: false,
            attributes: false
          }
        }
      ],
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
      "no-console": "error",
      "no-unsanitized/method": "error",
      "security/detect-object-injection": "off"
    }
  },
  {
    files: ["packages/heat-sdk/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: ["better-sqlite3", "drizzle-orm", "express", "mongodb", "mysql2", "node:*", "pg"]
        }
      ]
    }
  },
  {
    files: ["packages/heat-collector/**/*.ts", "examples/express-collector/**/*.ts", "e2e/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: ["**/*.test.ts", "e2e/**/*.ts", "**/*.config.ts", "playwright.config.ts"],
    rules: {
      "no-console": "off",
      "no-unsanitized/method": "off"
    }
  }
);
