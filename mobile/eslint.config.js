const { defineConfig, globalIgnores } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  globalIgnores(["dist/*", "src/app-template/**"]),
  expoConfig,
  {
    files: ["src/hooks/use-color-scheme.web.ts"],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
]);