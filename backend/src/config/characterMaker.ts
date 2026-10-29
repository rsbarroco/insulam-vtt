/** Public, non-secret configuration for the optional snapshot handoff. */
export interface CharacterMakerConfig {
  origin: string;
}

/**
 * An origin only, never a service URL, redirect target or credential. The
 * explicit shape check happens before URL normalization, so /a/.., empty
 * query/hash markers, backslashes and user-info cannot become valid origins.
 */
export function parseCharacterMakerOrigin(value: string | undefined, production: boolean): string | null {
  const raw = value?.trim();
  if (!raw || raw.length > 2048 || /[\s\\@*]/.test(raw)) return null;
  const parts = /^(https?):\/\/([^/?#]+)\/?$/i.exec(raw);
  if (!parts) return null;

  try {
    const url = new URL(raw);
    if (url.username || url.password || url.hostname.includes('*') || url.pathname !== '/' || url.search || url.hash) return null;
    if (url.protocol === 'https:') return url.origin;
    // Keep insecure transport local to development. Require the spelling to
    // be explicit too: numeric/octal/hex IPv4 aliases are not configuration.
    const loopbackAuthority = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(parts[2]);
    if (!production && url.protocol === 'http:' && loopbackAuthority) return url.origin;
  } catch { /* Invalid or unsupported URLs simply leave the feature disabled. */ }
  return null;
}

/** No value, invalid value, or HTTP in production means no advertised feature. */
export function getCharacterMakerConfig(env: NodeJS.ProcessEnv = process.env): CharacterMakerConfig | undefined {
  const origin = parseCharacterMakerOrigin(env.INSULAM_CHARACTER_MAKER_ORIGIN, env.NODE_ENV === 'production');
  return origin ? { origin } : undefined;
}
