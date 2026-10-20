import { describe, expect, it } from 'vitest';

import { isMfaExempt } from './mfa-exemption.js';

const NOW = new Date('2026-10-19T15:00:00Z');

describe('isMfaExempt', () => {
  it('sin exención no exime', () => {
    expect(isMfaExempt({ mfaExemptAt: null, mfaExemptUntil: null }, NOW)).toBe(false);
  });

  it('exención indefinida exime siempre', () => {
    expect(
      isMfaExempt({ mfaExemptAt: new Date('2026-01-01T00:00:00Z'), mfaExemptUntil: null }, NOW),
    ).toBe(true);
  });

  it('exención temporal exime hasta su vencimiento y después no', () => {
    const user = {
      mfaExemptAt: new Date('2026-10-18T00:00:00Z'),
      mfaExemptUntil: new Date('2026-10-20T00:00:00Z'),
    };
    expect(isMfaExempt(user, NOW)).toBe(true);
    expect(isMfaExempt(user, new Date('2026-10-20T00:00:00Z'))).toBe(false);
  });
});
