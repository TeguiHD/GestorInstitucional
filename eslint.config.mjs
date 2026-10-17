// @ts-check
/**
 * Root ESLint flat config for the whole monorepo.
 *
 * Each workspace runs `eslint src` from its own directory; ESLint walks up and
 * picks this file. Type-aware rules use the TypeScript project service, which
 * resolves the nearest tsconfig.json for every linted file.
 */
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const API_FILES = ['apps/api/**/*.ts'];
const WEB_FILES = ['apps/web/**/*.{ts,tsx}'];
const SHARED_FILES = ['packages/shared/**/*.ts'];
const TEST_FILES = ['**/*.{spec,test}.{ts,tsx}', '**/test/**/*.{ts,tsx}'];

export default defineConfig(
  {
    name: 'asistencia/ignores',
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/dev-dist/**',
      'apps/web/src/routeTree.gen.ts',
      // Compiled artefacts of vite.config.ts emitted by `tsc -b`.
      'apps/web/vite.config.js',
      'apps/web/vite.config.d.ts',
      '**/test-output/**',
      '**/__fixtures__/output/**',
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    name: 'asistencia/typescript',
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'warn',
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  {
    name: 'asistencia/api',
    files: API_FILES,
    languageOptions: {
      globals: { ...globals.node },
    },
    // `consistent-type-imports` is intentionally NOT enabled here: NestJS relies on
    // `emitDecoratorMetadata`, so constructor-injected classes and decorated DTOs must
    // stay as runtime (value) imports. Converting them to `import type` breaks DI.
  },

  {
    name: 'asistencia/shared',
    files: SHARED_FILES,
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },

  {
    name: 'asistencia/web',
    files: WEB_FILES,
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      // React Compiler diagnostics (react-hooks v7) that flag pre-existing patterns
      // (sync setState inside effects, components declared during render, Date.now()
      // in render). Fixing them means restructuring components, so they stay visible
      // as warnings until those components are refactored. The app does not use the
      // React Compiler, so they carry no build-time risk.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/purity': 'warn',
      'react-refresh/only-export-components': [
        'warn',
        // TanStack Router file routes export a `Route` object next to the component.
        { allowConstantExport: true, allowExportNames: ['Route'] },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },

  {
    name: 'asistencia/tests',
    files: TEST_FILES,
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Must stay last: turns off every stylistic rule that Prettier owns.
  prettier,
);
