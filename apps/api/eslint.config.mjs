import base from '@adventure/config/eslint';

export default [
  ...base,
  {
    rules: {
      /**
       * DESLIGADA DE PROPOSITO.
       *
       * O NestJS resolve as dependencias pelos metadados que o TypeScript
       * emite com emitDecoratorMetadata. Um servico injetado no construtor
       * parece "usado apenas como tipo" para o ESLint, mas trocar por
       * `import type` apaga a classe na compilacao e a injecao passa a
       * falhar em tempo de execucao, com erro obscuro.
       */
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
