import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import SourceNotice from '../SourceNotice';
import { BRAND, SOURCE_CODE_URL } from '@/config/brand';

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.resetModules(); });

describe('public source offer', () => {
  it('offers fork source and keeps upstream attribution without an account', () => {
    render(<SourceNotice />);
    expect(screen.getByRole('contentinfo', { name: 'Software source and credits' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Source code (AGPL-3.0)' })).toHaveAttribute('href', SOURCE_CODE_URL);
    expect(screen.getByRole('link', { name: 'CozyVTT' })).toHaveAttribute('href', BRAND.upstreamUrl);
    expect(screen.getByRole('link', { name: 'Source code (AGPL-3.0)' })).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it.each([
    ['', BRAND.repositoryUrl],
    ['https://github.com/rsbarroco/insulam-vtt/tree/aa614920339afa346718796bd52535b4d451bc4c', 'https://github.com/rsbarroco/insulam-vtt/tree/aa614920339afa346718796bd52535b4d451bc4c'],
    ['https://user:password@example.invalid/source', BRAND.repositoryUrl],
  ])('renders the sanitized build-time source URL %s', async (value, expected) => {
    vi.stubEnv('VITE_SOURCE_CODE_URL', value);
    vi.resetModules();
    const { default: BuiltSourceNotice } = await import('../SourceNotice');
    render(<BuiltSourceNotice />);
    expect(screen.getByRole('link', { name: 'Source code (AGPL-3.0)' })).toHaveAttribute('href', expected);
  });
});
