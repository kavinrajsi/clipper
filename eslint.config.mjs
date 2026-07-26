import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    // eslint-config-next does not enable no-undef, and this is a JS project
    // with no type checker — so a reference to a variable that was never
    // declared compiles fine and only fails at request time. That shipped a
    // ReferenceError on /campaigns once already. Server Components are
    // dynamic, so `next build` does not render them and will not catch it.
    files: ["src/**/*.js", "src/**/*.jsx"],
    rules: { "no-undef": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
