// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", ".expo/*", ".expo-*/**", ".verify-*/**"],
    rules: {
      // Existing screens intentionally load/synchronize remote state from effects.
      // Keep hooks correctness enabled, but do not treat these async loading patterns as release-blocking.
      "react-hooks/set-state-in-effect": "off",
    },
  }
]);
