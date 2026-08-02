import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Configuracao base de lint compartilhada por todos os pacotes TypeScript.
 * Cada app importa e estende conforme sua necessidade.
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/build/**', '**/coverage/**', '**/node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.node },
    },
    rules: {
      /* Argumentos e variaveis prefixados com _ sao intencionalmente ignorados. */
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      /* Regras de seguranca: tipagem fraca esconde bugs em runtime. */
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  /* Deve ser o ultimo: desliga regras de estilo que conflitam com o Prettier. */
  prettier,
);
