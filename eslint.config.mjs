import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import { globalIgnores } from "eslint/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

// Nested directories are archived sibling projects, not part of this app's build.
const config = [globalIgnores(["**/.next*/**", "node_modules/**", "coverage/**", "next-env.d.ts", "releases/**", "corrective-ai-studio-product-gallery-v3/**", "riezz99-ui-work/**", "scbz-review-20261005-upstream-diagnostic/**"]), ...compat.extends("next/core-web-vitals", "next/typescript")];
export default config;
