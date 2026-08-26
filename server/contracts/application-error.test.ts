import { describe, expect, it } from 'vitest';
import { applicationError } from './application-error';

describe('ApplicationError contract', () => {
  it.each([
    ['validation', 'none', false],
    ['conflict', 'refresh', false],
    ['permission', 'contact_support', false],
    ['not_found', 'refresh', false],
    ['infrastructure', 'retry', true],
  ] as const)('keeps the %s fixture transport-neutral', (category, recovery, retryable) => {
    const error = applicationError('fixture', `FIXTURE_${category.toUpperCase()}`, category, recovery, retryable);
    expect(error).toBeInstanceOf(Error);
    expect(error.details).toMatchObject({ code: `FIXTURE_${category.toUpperCase()}`, category, recovery, retryable });
  });
});
