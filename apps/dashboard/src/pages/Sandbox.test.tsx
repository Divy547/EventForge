import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, vi } from 'vitest';
import { Sandbox } from './Sandbox';
import type { EventWithDeliveries } from '@/lib/api';
import { eventDetailFixture } from '@/test/fixtures';
import { renderAt } from '@/test/render';

const EVENT_ID = 'eeeeeeee-1111-4222-8333-444444444444';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function eventWith(status: string, attempts: number): Response {
  const delivery = eventDetailFixture.deliveries[0]!;
  const body: EventWithDeliveries = {
    ...eventDetailFixture,
    id: EVENT_ID,
    deliveries: [
      { ...delivery, status: status as typeof delivery.status, attemptsCount: attempts },
    ],
  };
  return new Response(JSON.stringify(body), { status: 200 });
}

const sentOk = () =>
  Promise.resolve(
    new Response(
      JSON.stringify({ eventId: EVENT_ID, scenario: 'flaky', eventType: 'sandbox.flaky' }),
      { status: 202 },
    ),
  );

function renderPage(onSignOut = () => {}) {
  return renderAt(<Sandbox apiKey="ef_live_sb" onSignOut={onSignOut} />, '/sandbox');
}

const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

describe('Sandbox page', () => {
  it('offers the four scenarios', () => {
    renderPage();
    expect(screen.getAllByRole('button', { name: /Send test event/ })).toHaveLength(4);
    expect(screen.getByText('Fails twice, then succeeds')).toBeInTheDocument();
  });

  it('sends the chosen scenario with the key and shows the run', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string) =>
        url === '/v1/sandbox/events' ? sentOk() : Promise.resolve(eventWith('PENDING', 0)),
      );
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    await user().click(
      screen.getByRole('button', { name: 'Send test event: Fails twice, then succeeds' }),
    );

    const sendCall = fetchMock.mock.calls.find((c) => c[0] === '/v1/sandbox/events')!;
    expect(sendCall[1]).toMatchObject({
      method: 'POST',
      headers: { 'X-API-Key': 'ef_live_sb', 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'flaky' }),
    });
    expect(await screen.findByText(/sandbox\.flaky/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View event' })).toHaveAttribute(
      'href',
      `/events/${EVENT_ID}`,
    );
  });

  it('follows the delivery until it reaches a final state, then stops polling', async () => {
    const statuses = [
      eventWith('PENDING', 0),
      eventWith('FAILED', 1),
      eventWith('FAILED', 2),
      eventWith('COMPLETED', 3),
    ];
    let polls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url === '/v1/sandbox/events') return sentOk();
        return Promise.resolve(statuses[Math.min(polls++, statuses.length - 1)]!.clone());
      }),
    );
    renderPage();
    await user().click(screen.getAllByRole('button', { name: /Send test event/ })[1]!);

    const item = (await screen.findByText(/sandbox\.flaky/)).closest('li')!;
    await waitFor(() => expect(within(item).getByText('Pending')).toBeInTheDocument());

    await act(() => vi.advanceTimersByTimeAsync(1500));
    await waitFor(() => expect(within(item).getByText('Retrying')).toBeInTheDocument());
    expect(within(item).getByText(/1 of/)).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(3000));
    await waitFor(() => expect(within(item).getByText('Completed')).toBeInTheDocument());
    expect(within(item).getByText(/3 of/)).toBeInTheDocument();

    const pollsWhenDone = polls;
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(polls).toBe(pollsWhenDone);
  });

  it('points a dead-lettered run at the replay page', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((url: string) =>
          url === '/v1/sandbox/events' ? sentOk() : Promise.resolve(eventWith('DEAD_LETTER', 6)),
        ),
    );
    renderPage();
    await user().click(screen.getAllByRole('button', { name: /Send test event/ })[2]!);

    expect(
      await screen.findByRole('link', { name: 'Replay it from the dead-letter queue' }),
    ).toHaveAttribute('href', '/dead-letters');
    expect(screen.getByText('Dead letter')).toBeInTheDocument();
  });

  it('explains a rate limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })));
    renderPage();
    await user().click(screen.getAllByRole('button', { name: /Send test event/ })[0]!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sandbox limit reached');
  });

  it('signs out when the key has expired', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const onSignOut = vi.fn();
    renderPage(onSignOut);
    await user().click(screen.getAllByRole('button', { name: /Send test event/ })[0]!);
    await waitFor(() => expect(onSignOut).toHaveBeenCalled());
  });
});
