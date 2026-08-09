const browserGlobals = {
  KB: 'readonly',
  window: 'readonly',
  document: 'readonly',
  getComputedStyle: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  BroadcastChannel: 'readonly',
  DOMException: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  history: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  KeyboardEvent: 'readonly',
  MouseEvent: 'readonly',
  DragEvent: 'readonly',
  FileReader: 'readonly',
  URL: 'readonly',
  Blob: 'readonly',
  NodeList: 'readonly',
  Node: 'readonly',
  Element: 'readonly',
  HTMLElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLTextAreaElement: 'readonly',
  HTMLSelectElement: 'readonly',
  HTMLOptionElement: 'readonly',
  HTMLFormElement: 'readonly',
  Option: 'readonly',
  confirm: 'readonly',
  MutationObserver: 'readonly',
  IntersectionObserver: 'readonly',
  CSS: 'readonly',
  crypto: 'readonly',
  indexedDB: 'readonly',
  globalThis: 'readonly'
};

const coreRules = {
  'no-unused-vars': ['error', { args: 'after-used', vars: 'all', caughtErrors: 'none' }],
  'no-undef': 'error',
  'no-constant-condition': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-cond-assign': ['error', 'except-parens'],
  'no-func-assign': 'error',
  'no-unreachable': 'error'
};

const js = {
  name: 'kanban-js',
  files: ['js/**/*.js'],
  languageOptions: {
    ecmaVersion: 2015,
    sourceType: 'script',
    globals: browserGlobals
  },
  rules: coreRules
};

// js/core/* is the deterministic layer; it additionally runs under Node for
// the unit suite (UMD factory pattern), so module/require/exports are valid
// there — but NOT in browser-only modules, where a stray Node global should
// be flagged.
const jsCore = {
  name: 'kanban-js-core',
  files: ['js/core/**/*.js'],
  languageOptions: {
    ecmaVersion: 2015,
    sourceType: 'script',
    globals: Object.assign({}, browserGlobals, {
      module: 'readonly',
      require: 'readonly',
      exports: 'readonly',
      process: 'readonly'
    })
  },
  rules: coreRules
};

const tests = {
  name: 'kanban-tests',
  files: ['tests/**/*.js'],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'commonjs',
    globals: {
      console: 'readonly',
      process: 'readonly',
      require: 'readonly',
      module: 'readonly',
      __dirname: 'readonly',
      setTimeout: 'readonly',
      clearTimeout: 'readonly',
      Date: 'readonly',
      JSON: 'readonly'
    }
  },
  rules: {
    'no-unused-vars': ['error', { args: 'after-used', vars: 'all', caughtErrors: 'none' }],
    'no-undef': 'error',
    'no-constant-condition': 'error',
    'no-dupe-keys': 'error',
    'no-cond-assign': ['error', 'except-parens'],
    'no-unreachable': 'error'
  }
};

const smoke = {
  name: 'kanban-smoke',
  files: ['tests/kanban-smoke.js'],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'commonjs',
    // A Node test harness whose page.evaluate callbacks run browser code:
    // browser globals plus the Node ones the harness itself uses.
    globals: Object.assign({}, browserGlobals, {
      process: 'readonly',
      require: 'readonly',
      module: 'readonly',
      __dirname: 'readonly',
      Date: 'readonly',
      JSON: 'readonly',
      IDBObjectStore: 'readonly',
      fetch: 'readonly',
      caches: 'readonly'
    })
  },
  rules: coreRules
};

const nodeTools = {
  name: 'kanban-node-tools',
  files: ['serve.js', 'scripts/**/*.js'],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'commonjs',
    globals: {
      console: 'readonly',
      process: 'readonly',
      require: 'readonly',
      module: 'readonly',
      __dirname: 'readonly',
      Buffer: 'readonly',
      URL: 'readonly'
    }
  },
  rules: {
    'no-unused-vars': ['error', { args: 'after-used', vars: 'all', caughtErrors: 'none' }],
    'no-undef': 'error',
    'no-constant-condition': 'error',
    'no-dupe-keys': 'error',
    'no-dupe-args': 'error',
    'no-cond-assign': ['error', 'except-parens'],
    'no-func-assign': 'error',
    'no-unreachable': 'error'
  }
};

const sw = {
  name: 'kanban-sw',
  files: ['sw.js'],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'script',
    globals: {
      self: 'readonly',
      caches: 'readonly',
      clients: 'readonly',
      URL: 'readonly',
      fetch: 'readonly',
      console: 'readonly'
    }
  },
  rules: {
    'no-unused-vars': ['error', { args: 'after-used', vars: 'all', caughtErrors: 'none' }],
    'no-undef': 'error',
    'no-constant-condition': 'error',
    'no-dupe-keys': 'error',
    'no-dupe-args': 'error',
    'no-cond-assign': ['error', 'except-parens'],
    'no-func-assign': 'error',
    'no-unreachable': 'error'
  }
};

// The config file itself must lint cleanly (the lint script includes it).
const eslintConfig = {
  name: 'kanban-eslint-config',
  files: ['eslint.config.js'],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'commonjs',
    globals: {
      console: 'readonly',
      module: 'readonly',
      require: 'readonly',
      Object: 'readonly'
    }
  },
  rules: {
    'no-unused-vars': ['error', { args: 'after-used', vars: 'all', caughtErrors: 'none' }],
    'no-undef': 'error'
  }
};

module.exports = [js, jsCore, tests, smoke, nodeTools, sw, eslintConfig];
