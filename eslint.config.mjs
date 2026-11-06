import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
    baseDirectory: __dirname,
});

const eslintConfig = [
    ...compat.extends("next/core-web-vitals", "next/typescript"),
    {
        ignores: [
            ".next/**",
            "node_modules/**",
            "playwright-report/**",
            "test-results/**",
            ".cache/**",
            /*
             * Local-only starter/scratch material is never committed (CI has no
             * .scratch directory), so it must not affect the lint gate.
             */
            ".scratch/**",
            /*
             * The invoice templates belong to ticket 08 and still reference the
             * invoice app that ticket 01 removed; they are not compiled or
             * linted until that ticket replaces them. See THIRD-PARTY.md.
             */
            "app/components/templates/**",
            "next-env.d.ts",
            "next.config.js",
            "tailwind.config.js",
            "postcss.config.js",
        ],
    },
];

export default eslintConfig;
