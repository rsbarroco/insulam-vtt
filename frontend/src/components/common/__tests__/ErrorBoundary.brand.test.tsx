import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';
import { BRAND } from '@/config/brand';

function BrokenPage(): never { throw new Error('Synthetic render failure'); }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('fork error screen', () => {
  it('links to the available project page, not a disabled issue tracker or upstream', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><BrokenPage /></ErrorBoundary>);
    const project = screen.getByRole('link', { name: 'View the Insulam VTT project on GitHub (opens in new tab)' });
    expect(project).toHaveAttribute('href', BRAND.repositoryUrl);
    expect(screen.getByRole('link', { name: 'Source code (AGPL-3.0)' })).toBeInTheDocument();
  });
  it('retains one source offer after a repeated failed render', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><BrokenPage /></ErrorBoundary>);
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(screen.getAllByRole('link', { name: 'Source code (AGPL-3.0)' })).toHaveLength(1);
  });
});
