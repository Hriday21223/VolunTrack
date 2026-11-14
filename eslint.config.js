import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist', 'node_modules', 'dev-dist', '_site', 'android', 'ios', '.kilo'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // A missing import is a crash at the call site, not a style issue.
      'no-undef': 'error',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  // Dates (#878): toISOString() is the UTC date, already "tomorrow" in the US
  // evening, so it must not stand in for the person's "today". Use
  // todayLocal() from src/utils/date.js, or date-fns format(). Where UTC is
  // really meant (week maths on YYYY-MM-DD strings), disable it on that line
  // with a reason.
  {
    files: ['src/**/*.{js,jsx}'],
    rules: {
      'no-restricted-syntax': ['error',
        {
          selector: "CallExpression[callee.property.name='slice'][callee.object.callee.property.name='toISOString']",
          message: "toISOString().slice(0, 10) is the UTC date. Use todayLocal() / date-fns format() for the person's date, or disable this line with a reason if UTC is meant.",
        },
        {
          selector: "MemberExpression[object.callee.property.name='split'][object.callee.object.callee.property.name='toISOString']",
          message: "toISOString().split('T')[0] is the UTC date. Use todayLocal() / date-fns format() for the person's date, or disable this line with a reason if UTC is meant.",
        },
      ],
    },
  },
]
