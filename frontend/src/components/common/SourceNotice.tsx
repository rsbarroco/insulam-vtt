import { BRAND, SOURCE_CODE_URL } from '@/config/brand';

/** Visible on public and signed-in routes; no account required to obtain source. */
export default function SourceNotice() {
  return (
    <footer aria-label="Software source and credits" className="shrink-0 border-t border-moss-green/20 bg-parchment px-4 py-3 text-center text-xs text-ink">
      <span>{BRAND.name} · </span>
      <a className="underline" href={SOURCE_CODE_URL} target="_blank" rel="noopener noreferrer">Source code (AGPL-3.0)</a>
      <span> · Based on </span>
      <a className="underline" href={BRAND.upstreamUrl} target="_blank" rel="noopener noreferrer">CozyVTT</a>
    </footer>
  );
}
