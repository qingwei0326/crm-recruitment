import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        AbortController: 'readonly',
        CustomEvent: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        getComputedStyle: 'readonly',
        matchMedia: 'readonly',
        scrollTo: 'readonly',
        resizeTo: 'readonly',
        resizeBy: 'readonly',
        moveBy: 'readonly',
        moveTo: 'readonly',
        open: 'readonly',
        close: 'readonly',
        print: 'readonly',
        focus: 'readonly',
        blur: 'readonly',
        find: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        createImageBitmap: 'readonly',
        queueMicrotask: 'readonly',
        structuredClone: 'readonly',
        crypto: 'readonly',
        performance: 'readonly',
        console: 'readonly',
        IntersectionObserver: 'readonly',
        indexedDB: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Design tokens live in tailwind.config.js; don't reintroduce the arbitrary values they replaced.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/text-.1[01]px.|bg-.#f5f7fb.|shadow-.0_2px_10px/]',
          message: 'Use design tokens: text-2xs/text-3xs, bg-surface-page, shadow-panel(-dark).',
        },
        {
          selector: 'TemplateElement[value.raw=/text-.1[01]px.|bg-.#f5f7fb.|shadow-.0_2px_10px/]',
          message: 'Use design tokens: text-2xs/text-3xs, bg-surface-page, shadow-panel(-dark).',
        },
      ],
    },
  },
  {
    files: ['src/__tests__/**', '**/*.test.*', '**/*.spec.*'],
    languageOptions: {
      globals: {
        global: 'readonly',
        vi: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  },
  {
    ignores: ['dist/', 'node_modules/'],
  },
];
