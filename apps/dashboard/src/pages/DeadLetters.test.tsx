import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { DeadLetters } from './DeadLetters';
import {
  deliveriesPage,
  deliverySummaryFixture,
  subscriptionFixture,
  subscriptionsResponse,
} from '@/test/fixtures';
import { renderAt } from '@/test/render';
import type { DeliverySummary } from '@/lib/api';

afterEach(() => vi.unstubAllGlobals());

const second: DeliverySummary = {
  ...deliverySummaryFixture,
  id: 'eeeeeeee-1111-4222-8333-444444444444',
  subscriptionId: 'unknown-sub',
};
const SUB = { ...subscriptionFixture, id: deliverySummaryFixture.subscriptionId };

type Handler = (url: string, init?: RequestInit) => Promise<Response> | Response;

/** Answers the list, the subscription names and each replay call separately. */
function mockApi(handlers: { list?: Handler; replay?: Handler; replayBatch?: Handler } = {}) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.startsWith('/v1/subscriptions')) return Promise.resolve(subscriptionsResponse([SUB]));
    if (url === '/v1/deliveries/replay') {
      return Promise.resolve(
        (handlers.replayBatch ?? (() => new Response('{}', { status: 500 })))(url, init),
      );
    }
    if (url.endsWith('/replay')) {
      return Promise.resolve(
        (handlers.replay ?? (() => new Response('{}', { status: 500 })))(url, init),
      );
    }
    return Promise.resolve(
      (handlers.list ?? (() => deliveriesPage([deliverySummaryFixture, second])))(url, init),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage(onSignOut = () => {}, path = '/dead-letters') {
  return renderAt(<DeadLetters apiKey="ef_live_abc" onSignOut={onSignOut} />, path);
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('Dead letters list', () => {
  it('lists only dead-letter deliveries and names the subscription when it can', async () => {
    const fetchMock = mockApi();
    renderPage();

    const rows = await screen.findAllByRole('row');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('status=DEAD_LETTER'),
      expect.anything(),
    );
    await waitFor(() => expect(within(rows[1]!).getByText('Billing hook')).toBeInTheDocument());
    // The second row's subscription is unknown, so it falls back to a short ID.
    expect(within(rows[2]!).getByText('unknown-')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('6 of 6')).toBeInTheDocument();
  });

  it('explains an empty queue', async () => {
    mockApi({ list: () => deliveriesPage([]) });
    renderPage();
    expect(await screen.findByText(/No dead letters/)).toBeInTheDocument();
  });

  it('shows an error when the list cannot be loaded', async () => {
    mockApi({ list: () => new Response('{}', { status: 500 }) });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('unexpected response');
  });

  it('signs out when the key is rejected', async () => {
    mockApi({ list: () => new Response('{}', { status: 401 }) });
    const onSignOut = vi.fn();
    renderPage(onSignOut);
    await waitFor(() => expect(onSignOut).toHaveBeenCalled());
  });
});

describe('Replaying one delivery', () => {
  it('posts to the delivery replay endpoint, reports it and refreshes the list', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      replay: () => json({ delivery: deliverySummaryFixture, replayed: true, message: 'ok' }),
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Replay delivery dddddddd' }));

    expect(await screen.findByText(/Replayed delivery dddddddd/)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/replay'))!;
    expect(call[0]).toBe(`/v1/deliveries/${deliverySummaryFixture.id}/replay`);
    expect((call[1] as RequestInit).method).toBe('POST');
    const lists = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('status=DEAD_LETTER'),
    );
    await waitFor(() => expect(lists.length).toBeGreaterThanOrEqual(1));
    expect(screen.getByRole('link', { name: 'See pending deliveries' })).toHaveAttribute(
      'href',
      '/deliveries?status=PENDING',
    );
  });

  it('says so when the delivery is no longer a dead letter', async () => {
    const user = userEvent.setup();
    mockApi({ replay: () => json({ title: 'Conflict' }, 409) });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Replay delivery dddddddd' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('no longer a dead letter');
  });

  it('signs out when the key is rejected mid-replay', async () => {
    const user = userEvent.setup();
    mockApi({ replay: () => new Response('{}', { status: 401 }) });
    const onSignOut = vi.fn();
    renderPage(onSignOut);

    await user.click(await screen.findByRole('button', { name: 'Replay delivery dddddddd' }));
    await waitFor(() => expect(onSignOut).toHaveBeenCalled());
  });
});

describe('Replaying a selection', () => {
  it('keeps the batch button disabled until something is selected', async () => {
    mockApi();
    renderPage();
    await screen.findAllByRole('row');
    expect(screen.getByRole('button', { name: 'Replay selected' })).toBeDisabled();
  });

  it('sends the chosen IDs in one request', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      replayBatch: () =>
        json({
          totalRequested: 2,
          replayedCount: 2,
          failedCount: 0,
          items: [
            { deliveryId: deliverySummaryFixture.id, success: true },
            { deliveryId: second.id, success: true },
          ],
        }),
    });
    renderPage();

    await user.click(await screen.findByRole('checkbox', { name: 'Select all on this page' }));
    await user.click(screen.getByRole('button', { name: 'Replay selected (2)' }));

    expect(await screen.findByText(/Replayed 2 deliveries/)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url]) => url === '/v1/deliveries/replay')!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      deliveryIds: [deliverySummaryFixture.id, second.id],
    });
    // The selection is cleared once it has been sent.
    expect(screen.getByRole('button', { name: 'Replay selected' })).toBeDisabled();
  });

  it('lists the deliveries the API could not replay', async () => {
    const user = userEvent.setup();
    mockApi({
      replayBatch: () =>
        json({
          totalRequested: 2,
          replayedCount: 1,
          failedCount: 1,
          items: [
            { deliveryId: deliverySummaryFixture.id, success: true },
            { deliveryId: second.id, success: false, error: 'Delivery is not DEAD_LETTER' },
          ],
        }),
    });
    renderPage();

    await user.click(await screen.findByRole('checkbox', { name: 'Select all on this page' }));
    await user.click(screen.getByRole('button', { name: 'Replay selected (2)' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Replayed 1 delivery; 1 could not be replayed.');
    expect(alert).toHaveTextContent('eeeeeeee: Delivery is not DEAD_LETTER');
  });

  it('toggles a single row', async () => {
    const user = userEvent.setup();
    mockApi();
    renderPage();

    const box = await screen.findByRole('checkbox', { name: 'Select delivery eeeeeeee' });
    await user.click(box);
    expect(screen.getByRole('button', { name: 'Replay selected (1)' })).toBeEnabled();
    await user.click(box);
    expect(screen.getByRole('button', { name: 'Replay selected' })).toBeDisabled();
  });
});
