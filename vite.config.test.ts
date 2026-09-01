// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import type { ConfigEnv, UserConfig } from 'vite';
import config from './vite.config';

const originalApiPort = process.env.API_PORT;

afterEach(() => {
  if (originalApiPort === undefined) delete process.env.API_PORT;
  else process.env.API_PORT = originalApiPort;
});

describe('Vite development proxy', () => {
  it('targets the backend port configured for the API server', async () => {
    process.env.API_PORT = '8790';
    const environment: ConfigEnv = { command: 'serve', mode: 'test', isSsrBuild: false, isPreview: false };
    const resolved = typeof config === 'function' ? await config(environment) : config;

    expect((resolved as UserConfig).server?.proxy?.['/api']).toBe('http://127.0.0.1:8790');
  });
});
