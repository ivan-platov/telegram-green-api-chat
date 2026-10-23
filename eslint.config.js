import js from '@eslint/js'
import react from '@eslint-react/eslint-plugin'
import stylistic from '@stylistic/eslint-plugin'
import { defineConfig, globalIgnores } from 'eslint/config'
import prettier from 'eslint-config-prettier/flat'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import imports from 'eslint-plugin-import-x'
import a11y from 'eslint-plugin-jsx-a11y-x'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const codeFiles = ['**/*.{js,mjs,ts,tsx}']
const declarations = ['const', 'let', 'var']

export default defineConfig(
  globalIgnores(['node_modules/', 'dist/', '.local/', '.artifacts/', 'docs/', 'source/']),
  {
    files: codeFiles,
    extends: [js.configs.recommended, imports.flatConfigs.recommended],
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          project: './tsconfig.json',
          alwaysTryTypes: true,
        }),
      ],
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'object-shorthand': ['error', 'always'],
      'sort-imports': ['error', { ignoreDeclarationSort: true, ignoreCase: true }],
      'prefer-template': 'error',
      'no-useless-return': 'error',
      'one-var': ['error', 'never'],
      'import-x/first': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'type'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended, imports.flatConfigs.typescript],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      react.configs['recommended-typescript'],
      react.configs['disable-naming-convention'],
      a11y.configs.recommended,
    ],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      '@eslint-react/rules-of-hooks': 'off',
      '@eslint-react/exhaustive-deps': 'off',
      '@eslint-react/dom-no-missing-button-type': 'error',
      '@eslint-react/dom-no-unknown-property': 'error',
      '@eslint-react/no-duplicate-key': 'error',
      '@eslint-react/jsx-no-useless-fragment': 'error',
      'jsx-a11y-x/control-has-associated-label': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  { files: ['tests/e2e/**/*.ts'], languageOptions: { globals: globals.browser } },
  { files: ['*.{js,ts}', 'tests/**/*.mjs'], languageOptions: { globals: globals.node } },
  {
    files: ['src/types/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportDeclaration[importKind!='type']",
          message: 'В types разрешены только type-only импорты.',
        },
        {
          selector:
            'Program > :not(ImportDeclaration):not(ExportNamedDeclaration):not(TSTypeAliasDeclaration):not(TSInterfaceDeclaration)',
          message: 'В types разрешены только type и interface, без исполняемого кода.',
        },
        {
          selector:
            "ExportNamedDeclaration:not([declaration.type='TSTypeAliasDeclaration']):not([declaration.type='TSInterfaceDeclaration'])",
          message: 'Из types можно экспортировать только type и interface.',
        },
      ],
    },
  },
  {
    files: ['src/components/MessageList.tsx'],
    rules: {
      // A labelled scroll region must accept focus and native keyboard scrolling.
      'jsx-a11y-x/no-noninteractive-tabindex': ['error', { roles: ['tabpanel', 'region'] }],
      'jsx-a11y-x/no-noninteractive-element-interactions': [
        'error',
        {
          ...a11y.configs.recommended.rules['jsx-a11y-x/no-noninteractive-element-interactions'][1],
          div: ['onKeyDown'],
        },
      ],
    },
  },
  {
    files: ['src/components/NewChatForm.tsx'],
    rules: {
      // Escape is delegated from the form's native controls; the form is not a button.
      'jsx-a11y-x/no-noninteractive-element-interactions': [
        'error',
        {
          ...a11y.configs.recommended.rules['jsx-a11y-x/no-noninteractive-element-interactions'][1],
          form: ['onKeyDown'],
        },
      ],
    },
  },
  prettier,
  {
    files: codeFiles,
    plugins: { '@stylistic': stylistic },
    rules: {
      curly: ['error', 'all'],
      '@stylistic/jsx-self-closing-comp': 'error',
      '@stylistic/lines-between-class-members': [
        'error',
        'always',
        { exceptAfterSingleLine: true },
      ],
      '@stylistic/jsx-curly-brace-presence': ['error', { props: 'never', children: 'never' }],
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: declarations, next: '*' },
        { blankLine: 'any', prev: declarations, next: declarations },
        {
          blankLine: 'always',
          prev: '*',
          next: ['return', 'export', 'function', 'class', 'interface', 'type'],
        },
        { blankLine: 'always', prev: 'block-like', next: '*' },
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'any', prev: 'import', next: 'import' },
      ],
    },
  },
)
