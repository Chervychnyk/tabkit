import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default defineConfig(
  { ignores: ['.output/', '.wxt/'] },
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    // svelte-check type-checks every file, WXT auto-imports (browser, defineContentScript…) included.
    rules: { 'no-undef': 'off' },
  },
  { files: ['**/*.svelte'], languageOptions: { parserOptions: { parser: ts.parser } } },
);
