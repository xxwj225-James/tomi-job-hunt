import { describe, expect, it } from 'vitest';
import { buildUpdateCheck, compareVersions } from './version.js';

describe('compareVersions', () => {
  it('orders basic versions', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBe(1);
    expect(compareVersions('0.1.9', '0.2.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('handles v-prefixes and unequal segment counts', () => {
    expect(compareVersions('v1.2', '1.2.0')).toBe(0);
    expect(compareVersions('0.10', '0.9.5')).toBe(1);
    expect(compareVersions('1.0', '1.0.1')).toBe(-1);
  });

  it('treats malformed segments as 0', () => {
    expect(compareVersions('0.1.x', '0.1.0')).toBe(0);
  });
});

describe('buildUpdateCheck', () => {
  it('flags a newer remote version', () => {
    const check = buildUpdateCheck('0.1.0', { version: '0.2.0', releaseUrl: 'https://x' });
    expect(check.updateAvailable).toBe(true);
    expect(check.latest?.version).toBe('0.2.0');
  });

  it('ignores equal or older versions and offline checks', () => {
    expect(buildUpdateCheck('0.2.0', { version: '0.2.0' }).updateAvailable).toBe(false);
    expect(buildUpdateCheck('0.2.0', { version: '0.1.9' }).updateAvailable).toBe(false);
    expect(buildUpdateCheck('0.2.0', null).updateAvailable).toBe(false);
  });
});
