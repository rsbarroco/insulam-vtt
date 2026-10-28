import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import SourceNotice from '../SourceNotice';
import { BRAND, SOURCE_CODE_URL } from '@/config/brand';

afterEach(cleanup);

describe('public source offer', () => {
  it('offers fork source and keeps upstream attribution without an account', () => {
    render(<SourceNotice />);
    expect(screen.getByRole('contentinfo', { name: 'Software source and credits' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Source code (AGPL-3.0)' })).toHaveAttribute('href', SOURCE_CODE_URL);
    expect(screen.getByRole('link', { name: 'CozyVTT' })).toHaveAttribute('href', BRAND.upstreamUrl);
    expect(screen.getByRole('link', { name: 'Source code (AGPL-3.0)' })).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
