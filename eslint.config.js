import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'dist-server/**', 'node_modules/**', 'reports/**', 'var/**', 'Rhiza-Dev-codex-rhiza-librechat-runtime/**', 'scripts/boundary-gates/fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // M01 / ADR-001: the legacy flat file remains a domain-type seam until M02
    // moves it to server/domain/. Keep both locations guarded during that move.
    files: ['server/**/*domain.ts', 'server/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'express', message: 'Domain must not depend on Express; depend on a port or domain contract instead.' },
          { name: 'pg', message: 'Domain must not depend on PostgreSQL; depend on a repository port instead.' },
        ],
        patterns: [
          { group: ['node:fs', 'node:fs/**', 'node:child_process', 'node:child_process/**'], message: 'Domain must not access host process capabilities; depend on a port instead.' },
          { group: ['@librechat/**', 'librechat', 'librechat/**', 'librechat-*', 'openai', 'openai/**', '@anthropic-ai/**', '@google/generative-ai', '@google/generative-ai/**', 'ollama', 'ollama/**', 'cohere-ai', 'cohere-ai/**', 'mistralai', 'mistralai/**', 'ai', 'ai/**', '@ai-sdk/**', 'langchain', 'langchain/**', '@langchain/**'], message: 'Domain must not depend on a concrete model or LibreChat SDK; depend on a domain contract instead.' },
        ],
      }],
    },
  },
  {
    files: ['server/application/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['node:fs', 'node:fs/**', 'node:path', 'node:path/**', 'node:os', 'node:os/**', 'node:crypto', 'node:crypto/**', 'node:child_process', 'node:child_process/**'], message: 'Application must depend on host ports, not Node host capabilities.' },
          { group: ['@librechat/**', 'librechat', 'librechat/**', 'librechat-*', 'openai', 'openai/**', '@anthropic-ai/**', '@google/generative-ai', '@google/generative-ai/**', 'ollama', 'ollama/**', 'cohere-ai', 'cohere-ai/**', 'mistralai', 'mistralai/**', 'ai', 'ai/**', '@ai-sdk/**', 'langchain', 'langchain/**', '@langchain/**'], message: 'Application must depend on runtime ports, not a concrete model or LibreChat SDK.' },
        ],
      }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['server/**', '@server/**', '../server/**', '../../server/**', '../../../server/**'], message: 'The web client may only reach the server through HTTP/API contracts.' },
        ],
      }],
    },
  },
  {
    // M01 / ADR-001: legacy Express routes may use only the repository port
    // injected by createApp. Concrete persistence adapters belong to bootstrap
    // (server/index.ts), never to a route module.
    files: ['server/app.ts', 'server/http/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'pg', message: 'Routes must use the injected WorkspaceRepository port, never PostgreSQL directly.' },
        ],
        patterns: [
          { group: ['**/postgres-store', '**/postgres-store.*', '**/persistence/**', '**/infrastructure/**'], message: 'Routes must use the injected WorkspaceRepository port, never a concrete persistence adapter.' },
        ],
      }],
    },
  },
  {
    // This partition is introduced by M02. Enforce the target rule before the
    // directory exists so a new HTTP facade cannot acquire a storage shortcut.
    files: ['server/http/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['../infrastructure/**', '../../infrastructure/**', '../postgres/**', '../../postgres/**', '../*store', '../*store.*'], message: 'HTTP routes must call Application commands/queries, never persistence adapters.' },
        ],
      }],
    },
  },
  {
    files: ['**/*.mjs'],
    rules: { 'no-undef': 'off' },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
