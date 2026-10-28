import { describe, expect, it } from 'vitest';
import { parseCharacterProjection } from './characterProjection';

const minimal = {
  schemaVersion: 1,
  readOnly: true,
  characterId: 'example-character',
  displayName: 'Example adventurer',
};

describe('parseCharacterProjection', () => {
  it('accepts identity without inventing stats or defaults', () => {
    expect(parseCharacterProjection(minimal)).toEqual(minimal);
  });

  it('accepts already-computed stats and a canonical UTC timestamp', () => {
    const input = {
      ...minimal,
      sourceUpdatedAt: '2026-10-28T12:34:56.000Z',
      hp: { current: 18, max: 24 },
      defense: 12,
      initiative: -2,
    };
    expect(parseCharacterProjection(input)).toEqual(input);
  });

  it('does not impose game rules on HP above maximum or zero maximum', () => {
    expect(parseCharacterProjection({ ...minimal, hp: { current: 5, max: 0 } })?.hp)
      .toEqual({ current: 5, max: 0 });
  });

  it('discards unknown and private source fields at every accepted level', () => {
    const parsed = parseCharacterProjection({
      ...minimal,
      owner: { email: 'not-real@example.invalid' },
      email: 'not-real@example.invalid',
      accessToken: 'synthetic-never-forward',
      shareToken: 'synthetic-never-forward',
      rules: { private: 'synthetic' },
      dados: { private: 'synthetic' },
      portraitUrl: 'https://example.invalid/not-authorized.png',
      hp: { current: 3, max: 5, private: 'synthetic' },
    });
    expect(parsed).toEqual({ ...minimal, hp: { current: 3, max: 5 } });
    expect(JSON.stringify(parsed)).not.toContain('synthetic');
  });

  it('returns a fresh frozen DTO with a fresh frozen HP object', () => {
    const input = { ...minimal, hp: { current: 3, max: 5 } };
    const parsed = parseCharacterProjection(input);
    expect(parsed).not.toBe(input);
    expect(parsed?.hp).not.toBe(input.hp);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed?.hp)).toBe(true);
    input.displayName = 'Changed input';
    input.hp.current = 1;
    expect(parsed?.displayName).toBe(minimal.displayName);
    expect(parsed?.hp?.current).toBe(3);
  });

  it.each([null, undefined, [], 'text', 1, true, new Date()])('rejects non-record input %s', (input) => {
    expect(parseCharacterProjection(input)).toBeNull();
  });

  it.each([undefined, null, 0, 2, '1'])('rejects unsupported schema version %s', (schemaVersion) => {
    expect(parseCharacterProjection({ ...minimal, schemaVersion })).toBeNull();
  });

  it.each([undefined, null, false, 1, 'true'])('requires literal readOnly true, not %s', (readOnly) => {
    expect(parseCharacterProjection({ ...minimal, readOnly })).toBeNull();
  });

  it.each(['characterId', 'displayName'])('rejects invalid required text in %s', (field) => {
    for (const invalid of [undefined, null, 42, '', '   ', 'line\nbreak', 'null\u0000byte', 'x'.repeat(201)]) {
      expect(parseCharacterProjection({ ...minimal, [field]: invalid })).toBeNull();
    }
  });

  it('enforces the narrower display-name bound', () => {
    expect(parseCharacterProjection({ ...minimal, displayName: 'x'.repeat(120) })).not.toBeNull();
    expect(parseCharacterProjection({ ...minimal, displayName: 'x'.repeat(121) })).toBeNull();
    expect(parseCharacterProjection({ ...minimal, characterId: 'x'.repeat(200) })).not.toBeNull();
  });

  it('treats the identifier as opaque text, not a URL or a lookup instruction', () => {
    const characterId = 'opaque:character/abc?not-a-network-request';
    expect(parseCharacterProjection({ ...minimal, characterId })?.characterId).toBe(characterId);
  });

  it.each(['defense', 'initiative'])('rejects non-finite or non-numeric %s', (field) => {
    for (const invalid of [NaN, Infinity, -Infinity, '12', null, {}]) {
      expect(parseCharacterProjection({ ...minimal, [field]: invalid })).toBeNull();
    }
  });

  it.each([
    null, [], {}, { current: 1 }, { max: 1 },
    { current: -1, max: 10 }, { current: 1, max: -1 },
    { current: NaN, max: 10 }, { current: 1, max: Infinity },
    { current: '1', max: 10 },
  ])('rejects malformed or negative HP %s', (hp) => {
    expect(parseCharacterProjection({ ...minimal, hp })).toBeNull();
  });

  it.each([
    null, 123, '', 'not a timestamp', '2026-10-28',
    '2026-02-30T12:34:56.000Z', '2026-10-28T25:34:56.000Z',
    '2026-10-28T12:34:56.000+00:00',
  ])('rejects non-canonical or invalid source timestamps %s', (sourceUpdatedAt) => {
    expect(parseCharacterProjection({ ...minimal, sourceUpdatedAt })).toBeNull();
  });

  it('rejects records inheriting a purported projection', () => {
    expect(parseCharacterProjection(Object.create(minimal))).toBeNull();
  });
});
