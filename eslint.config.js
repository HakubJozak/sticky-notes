import js from "@eslint/js"
import globals from "globals"

const VITEST_GLOBALS = {
  describe: "readonly",
  it: "readonly",
  test: "readonly",
  expect: "readonly",
  vi: "readonly",
  beforeAll: "readonly",
  beforeEach: "readonly",
  afterAll: "readonly",
  afterEach: "readonly"
}

export default [
  // reference-implementation.js is the prototype DESIGN.md says to delete
  { ignores: ["dist/**", "node_modules/**", "reference-implementation.js"] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      indent: ["error", 2, { SwitchCase: 1 }],
      quotes: ["error", "double", { avoidEscape: true, allowTemplateLiterals: true }]
    }
  },
  {
    files: ["test/**/*.js"],
    languageOptions: { globals: VITEST_GLOBALS }
  }
]
