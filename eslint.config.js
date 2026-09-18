import js from "@eslint/js";
import globals from "globals";

export default [
  // `.claude/` holds git worktrees of this repo, each with its own full `src/`.
  // Without it, `yarn lint` reports another branch's code as this one's.
  { ignores: ["dist/", "node_modules/", "test-results/", ".claude/"] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // "smart" allows `== null` (the null-or-undefined idiom) but requires
      // strict equality everywhere else.
      eqeqeq: ["error", "smart"],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
