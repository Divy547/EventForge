import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, vi } from 'vitest';
import { Events } from './Events';
import { eventFixture, eventsPage } from '@/test/fixtures';
import { renderAt } from '@/test/render';

afterEach(() => vi.unstubAllGlobals());

function mockFetch(impl: (url: string) => Promise<Response>) {
  const fetchMock = vi.fn().mockImplementation((url: string) => impl(url));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderEvents(path = '/events', onSignOut = () => {}) {
  return renderAt(
    <Routes>
      <Route path="/events" element={<Events apiKey="ef_live_abc" onSignOut={onSignOut} />} />
    </Routes>,
    path,
  );
}

describe('Events list', () => {
  it('lists events with a link to each detail page, and sends the key', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(eventsPage()));
    renderEvents();

    const link = await screen.findByRole('link', { name: 'order.created' });
    expect(link).toHaveAttribute('href', `/events/${eventFixture.id}`);
    expect(screen.getByText('billing-service')).toBeInTheDocument();
    expect(screen.getByText('11111111')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 1 · 1 event')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/events?page=1&limit=20',
      expect.objectContaining({ headers: { 'X-API-Key': 'ef_live_abc' } }),
    );
  });

  it('applies filters to the URL and the request, and clears them', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(eventsPage()));
    const user = userEvent.setup();
    renderEvents();
    await screen.findByRole('link', { name: 'order.created' });

    await user.type(screen.getByLabelText('Event type'), ' order.created ');
    await user.type(screen.getByLabelText('Source'), 'billing-service');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/events?eventType=order.created&source=billing-service',
      ),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/v1/events?page=1&limit=20&eventType=order.created&source=billing-service',
        expect.anything(),
      ),
    );
    expect(screen.getByLabelText('Event type')).toHaveValue('order.created');

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/events$/));
    expect(screen.getByLabelText('Event type')).toHaveValue('');
  });

  it('turns date filters into the start and end of the local day', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(eventsPage()));
    renderEvents('/events?from=2026-11-01&to=2026-11-02');
    await screen.findByRole('link', { name: 'order.created' });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://x');
    expect(url.searchParams.get('from')).toBe(new Date('2026-11-01T00:00:00.000').toISOString());
    expect(url.searchParams.get('to')).toBe(new Date('2026-11-02T23:59:59.999').toISOString());
  });

  it('ignores a malformed date or page in the URL instead of failing', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(eventsPage()));
    renderEvents('/events?from=garbage&page=-3');
    await screen.findByRole('link', { name: 'order.created' });
    expect(fetchMock).toHaveBeenCalledWith('/v1/events?page=1&limit=20', expect.anything());
  });

  it('pages forward and back, and disables the buttons at the ends', async () => {
    const fetchMock = mockFetch((url) => {
      const page = Number(new URL(url, 'http://x').searchParams.get('page'));
      return Promise.resolve(eventsPage([eventFixture], { total: 45, page, totalPages: 3 }));
    });
    const user = userEvent.setup();
    renderEvents();
    await screen.findByText('Page 1 of 3 · 45 events');
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Page 2 of 3 · 45 events');
    expect(screen.getByTestId('location')).toHaveTextContent('/events?page=2');
    expect(fetchMock).toHaveBeenLastCalledWith('/v1/events?page=2&limit=20', expect.anything());

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Page 3 of 3 · 45 events');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await screen.findByText('Page 2 of 3 · 45 events');
  });

  it('distinguishes an empty project from an empty filter result', async () => {
    mockFetch(() => Promise.resolve(eventsPage([])));
    const { unmount } = renderEvents();
    expect(await screen.findByText('No events yet.')).toBeInTheDocument();
    unmount();

    renderEvents('/events?source=nobody');
    expect(await screen.findByText('No events match these filters.')).toBeInTheDocument();
  });

  it('shows an error, and signs out when the key is rejected', async () => {
    mockFetch(() => Promise.resolve(new Response('{}', { status: 500 })));
    const { unmount } = renderEvents();
    expect(await screen.findByRole('alert')).toHaveTextContent('unexpected response');
    unmount();

    mockFetch(() => Promise.resolve(new Response('{}', { status: 401 })));
    const onSignOut = vi.fn();
    renderEvents('/events', onSignOut);
    await waitFor(() => expect(onSignOut).toHaveBeenCalled());
  });

  it('keeps the table on screen when a refresh fails', async () => {
    let calls = 0;
    mockFetch(() =>
      Promise.resolve(++calls === 1 ? eventsPage() : new Response('{}', { status: 503 })),
    );
    renderEvents();
    await screen.findByRole('link', { name: 'order.created' });

    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('order.created')).toBeInTheDocument();
  });
});
