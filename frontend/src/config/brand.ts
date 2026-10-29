/** Insulam presentation defaults. Upstream identifiers and storage keys stay compatible. */
export const BRAND = {
  name: 'Insulam VTT',
  description: 'A virtual tabletop for your Insulam RPG adventures.',
  markUrl: '/insulam-mark.svg',
  repositoryUrl: 'https://github.com/rsbarroco/insulam-vtt',
  upstreamUrl: 'https://github.com/CheekyChinchilla/CozyVTT',
  characterMakerUrl: 'https://charactermaker.insulamrpg.com/',
} as const;

/** Source links are navigation only; reject unsafe build-time URL schemes. */
export function sourceCodeUrl(value?: string): string {
  try {
    const url = new URL(value?.trim() || BRAND.repositoryUrl);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* Fall back to the public fork. */ }
  return BRAND.repositoryUrl;
}

export const SOURCE_CODE_URL = sourceCodeUrl(import.meta.env.VITE_SOURCE_CODE_URL);

export function instanceDisplayName(name?: string | null): string {
  return name?.trim() || BRAND.name;
}
