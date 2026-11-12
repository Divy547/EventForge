import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, vi } from 'vitest';
import { EventDetail } from './EventDetail';
import { eventDetailFixture, eventDetailResponse } from '@/test/fixtures';
import { renderAt } from '@/test/render';

afterEach(() => vi.unstubAllGlobals());

function renderDetail(onSignOut = () => {}) {
  return renderAt(
    <Routes>
      <Route
        path="/events/:id"
        element={<EventDetail apiKey="ef_live_abc" onSignOut={onSignOut} />}
      />
    </Routes>,
    `/events/${eventDetailFixture.id}`,
  );
}

describe('Event detail', () => {
  it('shows the event, its payload and one row per delivery', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(eventDetailResponse()));
    vi.stubGlobal('fetch', fetchMock);
    renderDetail();

    expect(await screen.findByRole('heading', { name: 'order.created' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/v1/events/${eventDetailFixture.id}`,
      expect.objectContaining({ headers: { 'X-API-Key': 'ef_live_abc' } }),
    );
    expect(screen.getByText(eventDetailFixture.id)).toBeInTheDocument();
    expect(screen.getByText('idem-1')).toBeInTheDocument();
    expect(screen.getByLabelText('Event payload')).toHaveTextContent('"orderId": "ord_123"');
    expect(screen.getByLabelText('Event metadata')).toHaveTextContent('"traceId": "tr_abc"');

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Billing hook')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Completed')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('2 of 6')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Dead letter')).toBeInTheDocument();
    expect(
      within(rows[0]!).getByRole('link', { name: 'View delivery to Billing hook' }),
    ).toHaveAttribute('href', '/deliveries/d1');
  });

  it('explains when no subscription matched', async () => {
    const empty = { ...eventDetailFixture, deliveries: [], metadata: {} };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(empty))));
    renderDetail();

    expect(await screen.findByText(/no active subscription matched/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Event metadata')).not.toBeInTheDocument();
  });

  it('says so when the event is not in this project', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    renderDetail();
    expect(await screen.findByRole('alert')).toHaveTextContent('No event with that ID');
    expect(screen.getByRole('link', { name: /All events/ })).toHaveAttribute('href', '/events');
  });

  it('signs out when the key is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const onSignOut = vi.fn();
    renderDetail(onSignOut);
    await waitFor(() => expect(onSignOut).toHaveBeenCalled());
  });
});
