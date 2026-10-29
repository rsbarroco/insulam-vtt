import { getCharacterMakerConfig, parseCharacterMakerOrigin } from '../characterMaker';

describe('CharacterMaker origin configuration', () => {
  it.each([undefined, '', ' ', '\n\t'])('is disabled when unset (%s)', (value) => {
    expect(parseCharacterMakerOrigin(value, false)).toBeNull();
    expect(getCharacterMakerConfig({ INSULAM_CHARACTER_MAKER_ORIGIN: value })).toBeUndefined();
  });

  it.each([
    'https://charactermaker.insulamrpg.com',
    'https://charactermaker.insulamrpg.com/',
    ' HTTPS://CHARACTERMAKER.INSULAMRPG.COM:443/ ',
  ])('normalizes a secure exact origin %s', (value) => {
    expect(parseCharacterMakerOrigin(value, true)).toBe('https://charactermaker.insulamrpg.com');
  });

  it('preserves an explicitly configured non-default HTTPS port', () => {
    expect(parseCharacterMakerOrigin('https://source.example:8443', true)).toBe('https://source.example:8443');
  });

  it.each(['http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001'])('allows %s only outside production', (origin) => {
    expect(getCharacterMakerConfig({ NODE_ENV: 'development', INSULAM_CHARACTER_MAKER_ORIGIN: origin })).toEqual({ origin });
    expect(getCharacterMakerConfig({ NODE_ENV: 'production', INSULAM_CHARACTER_MAKER_ORIGIN: origin })).toBeUndefined();
  });

  it.each([
    '/relative', 'https://', 'javascript:alert(1)', 'data:text/plain,hello', 'file:///tmp/source', 'ftp://source.example',
    'https://source.example/vtt/connect', 'https://source.example/a/..', 'https://source.example//',
    'https://source.example/%2f', 'https://source.example?token=secret', 'https://source.example?',
    'https://source.example#fragment', 'https://source.example#', 'https://user:secret@source.example',
    'https://@source.example', 'https://*.example', 'https://%2A.example', 'https://source.example\\other',
    'https://source.\nexample', 'https://one.example,https://two.example',
    'http://source.example', 'http://localhost.evil.example:3001', 'http://localhost.:3001',
    'http://0.0.0.0:3001', 'http://127.1:3001', 'http://2130706433:3001', 'http://0x7f000001:3001',
    'http://[::ffff:127.0.0.1]:3001', 'https://source.example:99999',
    `https://${'x'.repeat(2048)}.example`,
  ])('rejects non-origin or unsafe configuration %s', (value) => {
    expect(parseCharacterMakerOrigin(value, false)).toBeNull();
    expect(parseCharacterMakerOrigin(value, true)).toBeNull();
  });

  it('returns only the public origin, never other environment values', () => {
    expect(getCharacterMakerConfig({
      NODE_ENV: 'production', INSULAM_CHARACTER_MAKER_ORIGIN: 'https://source.example/',
      SESSION_SECRET: 'synthetic-never-return', DATABASE_URL: 'synthetic-never-return',
    })).toEqual({ origin: 'https://source.example' });
  });
});
