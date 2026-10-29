/**
 * Proposed read-only boundary for an Insulam character, not a source sheet.
 * The source service owns authorization and all rules/calculations. This
 * module performs no I/O, imports no game engine, and grants no permissions.
 */
export type CharacterProjection = Readonly<{
  schemaVersion: 1;
  readOnly: true;
  characterId: string;
  displayName: string;
  sourceUpdatedAt?: string;
  hp?: Readonly<{ current: number; max: number }>;
  defense?: number;
  initiative?: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length <= maxLength
    && value.trim().length > 0
    && !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

/**
 * Validate a decoded JSON response and return a fresh, frozen allowlisted DTO.
 * Unknown properties are intentionally discarded, never retained or logged.
 * This is shape validation only: readOnly is not proof of server authorization.
 * Callers must separately cap the HTTP body before decoding it.
 */
export function parseCharacterProjection(value: unknown): CharacterProjection | null {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.readOnly !== true
    || !isBoundedText(value.characterId, 200)
    || !isBoundedText(value.displayName, 120)) return null;

  const { sourceUpdatedAt, defense, initiative } = value;
  if (sourceUpdatedAt !== undefined && !isCanonicalTimestamp(sourceUpdatedAt)) return null;
  if (defense !== undefined && !isFiniteNumber(defense)) return null;
  if (initiative !== undefined && !isFiniteNumber(initiative)) return null;

  let hp: CharacterProjection['hp'];
  if (value.hp !== undefined) {
    if (!isRecord(value.hp)
      || !isFiniteNumber(value.hp.current) || value.hp.current < 0
      || !isFiniteNumber(value.hp.max) || value.hp.max < 0) return null;
    // No current <= max assumption: resource rules belong to the source service.
    hp = Object.freeze({ current: value.hp.current, max: value.hp.max });
  }

  return Object.freeze({
    schemaVersion: 1,
    readOnly: true,
    characterId: value.characterId,
    displayName: value.displayName,
    ...(sourceUpdatedAt !== undefined ? { sourceUpdatedAt } : {}),
    ...(hp !== undefined ? { hp } : {}),
    ...(defense !== undefined ? { defense } : {}),
    ...(initiative !== undefined ? { initiative } : {}),
  });
}
