import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { Deliveries } from './Deliveries';
import { deliveriesPage, deliverySummaryFixture } from '@/test/fixtures';
import { renderAt } from '@/test/render';

afterEach(() => vi.unstubAllGlobals());

function mockFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn().mockImplementation(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Deliveries list', () => {
  it('defaults to dead letters and links each row to its detail and event', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(deliveriesPage()));
    renderAt(<Deliveries apiKey="ef_live_abc" onSignOut={() => {}} />, '/deliveries');

    const row = (await screen.findAllByRole('row'))[1]!;
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/deliveries?page=1&limit=20&status=DEAD_LETTER',
      expect.objectContaining({ headers: { 'X-API-Key': 'ef_live_abc' } }),
    );
    expect(within(row).getByText('Dead letter')).toBeInTheDocument();
    expect(within(row).getByText('6 of 6')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'dddddddd' })).toHaveAttribute(
      'href',
      `/deliveries/${deliverySummaryFixture.id}`,
    );
    expect(within(row).getByRole('link', { name: '11111111' })).toHaveAttribute(
      'href',
      `/events/${deliverySummaryFixture.eventId}`,
    );
    expect(screen.getByRole('link', { name: 'Dead letter' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('asks for the status in the URL and offers every status as a link', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(deliveriesPage([])));
    renderAt(<Deliveries apiKey="k" onSignOut={() => {}} />, '/deliveries?status=COMPLETED&page=2');

    expect(await screen.findByText('No completed deliveries.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/deliveries?page=2&limit=20&status=COMPLETED',
      expect.anything(),
    );
    const nav = screen.getByRole('navigation', { name: 'Filter by status' });
    expect(within(nav).getAllByRole('link')).toHaveLength(5);
    expect(within(nav).getByRole('link', { name: 'Retrying' })).toHaveAttribute(
      'href',
      '/deliveries?status=FAILED',
    );
  });

  it('ignores an unknown status and a malformed page', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(deliveriesPage()));
    renderAt(<Deliveries apiKey="k" onSignOut={() => {}} />, '/deliveries?status=bogus&page=-3');
    await screen.findAllByRole('row');
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/deliveries?page=1&limit=20&status=DEAD_LETTER',
      expect.anything(),
    );
  });

  it('shows an error without discarding the page', async () => {
    mockFetch(() => Promise.resolve(new Response('{}', { status: 500 })));
    renderAt(<Deliveries apiKey="k" onSignOut={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('unexpected response');
  });

  it('signs out when the key is rejected', async () => {
    mockFetch(() => Promise.resolve(new Response('{}', { status: 401 })));
    const onSignOut = vi.fn();
    renderAt(<Deliveries apiKey="k" onSignOut={onSignOut} />);
    await waitFor(() => expect(onSignOut).toHaveBeenCalled());
  });
});
