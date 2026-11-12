import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { Overview } from './Overview';
import { statsResponse } from '@/test/fixtures';
import { renderAt } from '@/test/render';

afterEach(() => vi.unstubAllGlobals());

function mockFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn().mockImplementation(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Overview', () => {
  it('shows totals, success rate, the status breakdown and recent failures', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(statsResponse()));
    renderAt(<Overview apiKey="ef_live_abc" onSignOut={() => {}} />);

    expect(screen.getByText('Loading your project…')).toBeInTheDocument();
    expect(await screen.findByText('1,280')).toBeInTheDocument();
    expect(screen.getByText('2,560')).toBeInTheDocument();
    expect(screen.getByText('94.1%')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/stats?windowHours=24',
      expect.objectContaining({ headers: { 'X-API-Key': 'ef_live_abc' } }),
    );

    const breakdown = screen.getByRole('list', { name: 'Deliveries by status' });
    expect(within(breakdown).getByText('Completed').parentElement).toHaveTextContent('2,400');
    expect(within(breakdown).getByText('Dead letter').parentElement).toHaveTextContent('150');

    expect(screen.getByRole('link', { name: 'order.created' })).toHaveAttribute(
      'href',
      '/deliveries/d1',
    );
    expect(screen.getByText(/Endpoint answered HTTP 500 · 6 attempts/)).toBeInTheDocument();
    expect(screen.getByText(/connect ECONNREFUSED · 1 attempt$/)).toBeInTheDocument();
  });

  it('refetches with the chosen window', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(statsResponse()));
    renderAt(<Overview apiKey="k" onSignOut={() => {}} />);
    await screen.findByText('1,280');

    await userEvent.setup().click(screen.getByRole('button', { name: '7 d' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith('/v1/stats?windowHours=168', expect.anything()),
    );
    expect(screen.getByRole('button', { name: '7 d' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a dash and a hint while no delivery has finished, and an empty failure list', async () => {
    mockFetch(() => Promise.resolve(statsResponse({ successRate: null, recentFailures: [] })));
    renderAt(<Overview apiKey="k" onSignOut={() => {}} />);

    expect(await screen.findByText('–')).toBeInTheDocument();
    expect(screen.getByText('no delivery has finished yet')).toBeInTheDocument();
    expect(screen.getByText('No failures in this window.')).toBeInTheDocument();
  });

  it('signs out when the API rejects the key', async () => {
    const onSignOut = vi.fn();
    mockFetch(() => Promise.resolve(new Response('{}', { status: 401 })));
    renderAt(<Overview apiKey="revoked" onSignOut={onSignOut} />);

    await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1));
  });

  it('shows an error when the API is unreachable, and recovers on refresh', async () => {
    let fail = true;
    mockFetch(() =>
      fail ? Promise.reject(new TypeError('down')) : Promise.resolve(statsResponse()),
    );
    renderAt(<Overview apiKey="k" onSignOut={() => {}} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the API');

    fail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('1,280')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps showing the last data when a refresh fails', async () => {
    let fail = false;
    mockFetch(() =>
      fail
        ? Promise.resolve(new Response('{}', { status: 500 }))
        : Promise.resolve(statsResponse()),
    );
    renderAt(<Overview apiKey="k" onSignOut={() => {}} />);
    await screen.findByText('1,280');

    fail = true;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('unexpected response');
    expect(screen.getByText('1,280')).toBeInTheDocument();
  });
});
