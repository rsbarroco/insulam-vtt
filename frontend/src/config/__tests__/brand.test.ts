import { describe, expect, it } from 'vitest';
import { BRAND, instanceDisplayName, sourceCodeUrl } from '../brand';

describe('Insulam presentation defaults', () => {
  it('preserves a customized instance name and otherwise uses the fork name', () => {
    expect(instanceDisplayName('  Our table  ')).toBe('Our table');
    expect(instanceDisplayName('CozyVTT')).toBe('CozyVTT');
    for (const value of [undefined, null, '', '  ']) {
      expect(instanceDisplayName(value)).toBe('Insulam VTT');
    }
  });
  it('permits an HTTPS source release URL', () => {
    const release = `${BRAND.repositoryUrl}/tree/reviewed-release`;
    expect(sourceCodeUrl(release)).toBe(release);
  });
  it.each([undefined, '', 'javascript:alert(1)', 'http://example.com/source', '/relative', 'https://user:pass@example.com/source'])(
    'falls back safely for %s', (value) => expect(sourceCodeUrl(value)).toBe(BRAND.repositoryUrl),
  );
});
