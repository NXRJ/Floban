const js = {
  name: 'kanban-js',
  files: ['js/**/*.js'],
  languageOptions: {
    ecmaVersion: 2015,
    sourceType: 'script',
    globals: {
      KB: 'readonly',
      window: 'readonly',
      document: 'readonly',
      localStorage: 'readonly',
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
      globalThis: 'readonly',
      module: 'readonly',
      require: 'readonly',
      exports: 'readonly',
      process: 'readonly'
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
    globals: {
      console: 'readonly',
      process: 'readonly',
      require: 'readonly',
      module: 'readonly',
      __dirname: 'readonly',
      setTimeout: 'readonly',
      clearTimeout: 'readonly',
      Date: 'readonly',
      JSON: 'readonly',
      KB: 'readonly',
      document: 'readonly',
      window: 'readonly',
      localStorage: 'readonly',
      getComputedStyle: 'readonly',
      navigator: 'readonly',
      location: 'readonly',
      Event: 'readonly',
      KeyboardEvent: 'readonly',
      MouseEvent: 'readonly',
      DragEvent: 'readonly',
      NodeList: 'readonly',
      Element: 'readonly',
      HTMLElement: 'readonly',
      HTMLInputElement: 'readonly',
      HTMLSelectElement: 'readonly',
      Option: 'readonly',
      MutationObserver: 'readonly',
      requestAnimationFrame: 'readonly',
      CSS: 'readonly',
      crypto: 'readonly',
      Blob: 'readonly',
      FileReader: 'readonly',
      URL: 'readonly',
      indexedDB: 'readonly',
      IDBObjectStore: 'readonly',
      fetch: 'readonly',
      caches: 'readonly'
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

module.exports = [js, tests, smoke, nodeTools, sw];
