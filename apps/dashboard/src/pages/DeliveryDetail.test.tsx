import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, vi } from 'vitest';
import { DeliveryDetail } from './DeliveryDetail';
import { deliveryDetailFixture } from '@/test/fixtures';
import { renderAt } from '@/test/render';

afterEach(() => vi.unstubAllGlobals());

function renderDetail(onSignOut = () => {}) {
  return renderAt(
    <Routes>
      <Route
        path="/deliveries/:id"
        element={<DeliveryDetail apiKey="ef_live_abc" onSignOut={onSignOut} />}
      />
    </Routes>,
    `/deliveries/${deliveryDetailFixture.id}`,
  );
}

function stubDetail(detail: unknown = deliveryDetailFixture) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(detail)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Delivery detail', () => {
  it('shows the delivery facts and links to its event', async () => {
    const fetchMock = stubDetail();
    renderDetail();

    expect(await screen.findByText(deliveryDetailFixture.id)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/v1/deliveries/${deliveryDetailFixture.id}`,
      expect.objectContaining({ headers: { 'X-API-Key': 'ef_live_abc' } }),
    );
    expect(screen.getByText('Billing hook')).toBeInTheDocument();
    expect(screen.getByText('https://hooks.example.com/in')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /order\.created \(from billing-service\)/ }),
    ).toHaveAttribute('href', `/events/${deliveryDetailFixture.eventId}`);
  });

  it('lists attempts oldest first with status code, duration, error and response', async () => {
    stubDetail();
    renderDetail();

    const items = within(
      await screen.findByRole('list', { name: 'Delivery attempts' }),
    ).getAllByRole('listitem');
    expect(items).toHaveLength(3);

    expect(within(items[0]!).getByText('Attempt 1')).toBeInTheDocument();
    expect(within(items[0]!).getByText('Failed · HTTP 503')).toBeInTheDocument();
    expect(within(items[0]!).getByText('120 ms')).toBeInTheDocument();
    expect(within(items[0]!).getByLabelText('Response body of attempt 1')).toHaveTextContent(
      'upstream unavailable',
    );

    expect(within(items[1]!).getByText('Failed · No response')).toBeInTheDocument();
    expect(within(items[1]!).getByText('ETIMEDOUT: request timed out')).toBeInTheDocument();

    expect(within(items[2]!).getByText('Succeeded · HTTP 200')).toBeInTheDocument();
    expect(within(items[2]!).queryByLabelText(/Response body/)).not.toBeInTheDocument();
  });

  it('copes with a deleted subscription and no attempts yet', async () => {
    stubDetail({ ...deliveryDetailFixture, subscription: undefined, attempts: [] });
    renderDetail();
    expect(await screen.findByText('Deleted subscription')).toBeInTheDocument();
    expect(screen.getByText('No attempts have been made yet.')).toBeInTheDocument();
  });

  it('says so when the delivery is not in this project', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    renderDetail();
    expect(await screen.findByRole('alert')).toHaveTextContent('No delivery with that ID');
    expect(screen.getByRole('link', { name: /All deliveries/ })).toHaveAttribute(
      'href',
      '/deliveries',
    );
  });

  it('signs out when the key is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const onSignOut = vi.fn();
    renderDetail(onSignOut);
    await waitFor(() => expect(onSignOut).toHaveBeenCalled());
  });
});
