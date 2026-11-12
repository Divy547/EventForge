import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { Subscriptions } from './Subscriptions';
import { subscriptionFixture, subscriptionsResponse } from '@/test/fixtures';
import { renderAt } from '@/test/render';

afterEach(() => vi.unstubAllGlobals());

type Handler = (url: string, init?: RequestInit) => Promise<Response>;

/** Routes by method so a test can answer the list and a write differently. */
function mockApi(handlers: { get?: Handler; post?: Handler; patch?: Handler }) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toLowerCase() as 'get' | 'post' | 'patch';
    const handler =
      handlers[method] ?? (() => Promise.resolve(new Response('{}', { status: 500 })));
    return handler(url, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const listOk: Handler = () => Promise.resolve(subscriptionsResponse());

function bodyOf(call: unknown[]): unknown {
  return JSON.parse((call[1] as RequestInit).body as string);
}

function renderPage(onSignOut = () => {}) {
  return renderAt(<Subscriptions apiKey="ef_live_abc" onSignOut={onSignOut} />, '/subscriptions');
}

describe('Subscriptions list', () => {
  it('shows each subscription with its status and never a secret', async () => {
    const fetchMock = mockApi({ get: listOk });
    renderPage();

    const row = (await screen.findAllByRole('row'))[1]!;
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/subscriptions',
      expect.objectContaining({ headers: { 'X-API-Key': 'ef_live_abc' } }),
    );
    expect(within(row).getByText('Billing hook')).toBeInTheDocument();
    expect(within(row).getByText('https://hooks.example.com/in')).toBeInTheDocument();
    expect(within(row).getByText('order.created, payment.succeeded')).toBeInTheDocument();
    expect(within(row).getByText('50/s')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();
    expect(screen.queryByText(/whsec_/)).not.toBeInTheDocument();
  });

  it('explains an empty project', async () => {
    mockApi({ get: () => Promise.resolve(subscriptionsResponse([])) });
    renderPage();
    expect(await screen.findByText(/No subscriptions yet/)).toBeInTheDocument();
  });

  it('shows an error when the list cannot be loaded', async () => {
    mockApi({ get: () => Promise.resolve(new Response('{}', { status: 500 })) });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('unexpected response');
  });

  it('signs out when the key is rejected', async () => {
    mockApi({ get: () => Promise.resolve(new Response('{}', { status: 401 })) });
    const onSignOut = vi.fn();
    renderPage(onSignOut);
    await waitFor(() => expect(onSignOut).toHaveBeenCalled());
  });
});

describe('Creating a subscription', () => {
  async function fillForm(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: /New subscription/ }));
    await user.type(screen.getByLabelText('Name'), '  Orders hook ');
    await user.type(screen.getByLabelText('Target URL'), 'https://example.com/hook');
    await user.type(screen.getByLabelText('Event types'), 'order.created, order.created  user.*');
    await user.type(screen.getByLabelText(/Rate limit/), '25');
  }

  it('posts the values, shows the signing secret once and refreshes the list', async () => {
    const user = userEvent.setup();
    const created = { ...subscriptionFixture, name: 'Orders hook', signingSecret: 'whsec_abc123' };
    const fetchMock = mockApi({
      get: listOk,
      post: () => Promise.resolve(new Response(JSON.stringify(created), { status: 201 })),
    });
    renderPage();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Create subscription' }));

    const secret = await screen.findByText('whsec_abc123');
    expect(secret).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(post[0]).toBe('/v1/subscriptions');
    expect(bodyOf(post)).toEqual({
      name: 'Orders hook',
      targetUrl: 'https://example.com/hook',
      eventTypes: ['order.created', 'user.*'],
      rateLimitPerSecond: 25,
    });
    expect(
      fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === 'GET'),
    ).toHaveLength(2);

    // The secret disappears for good once dismissed.
    await user.click(screen.getByRole('button', { name: 'I have saved it' }));
    expect(screen.queryByText('whsec_abc123')).not.toBeInTheDocument();
  });

  it('omits an empty rate limit', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      get: listOk,
      post: () =>
        Promise.resolve(
          new Response(JSON.stringify({ ...subscriptionFixture, signingSecret: 'whsec_x' }), {
            status: 201,
          }),
        ),
    });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /New subscription/ }));
    await user.type(screen.getByLabelText('Name'), 'A');
    await user.type(screen.getByLabelText('Target URL'), 'https://example.com');
    await user.type(screen.getByLabelText('Event types'), '*');
    await user.click(screen.getByRole('button', { name: 'Create subscription' }));
    await screen.findByText('whsec_x');
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(bodyOf(post)).toEqual({
      name: 'A',
      targetUrl: 'https://example.com',
      eventTypes: ['*'],
    });
  });

  it('checks the fields before calling the API', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({ get: listOk });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /New subscription/ }));
    await user.click(screen.getByRole('button', { name: 'Create subscription' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Give the subscription a name');

    await user.type(screen.getByLabelText('Name'), 'A');
    await user.type(screen.getByLabelText('Target URL'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Create subscription' }));
    expect(screen.getByRole('alert')).toHaveTextContent('at least one event type');

    await user.type(screen.getByLabelText('Event types'), '*');
    await user.type(screen.getByLabelText(/Rate limit/), '0');
    await user.click(screen.getByRole('button', { name: 'Create subscription' }));
    expect(screen.getByRole('alert')).toHaveTextContent('whole number');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it("shows the API's own explanation when it rejects the values", async () => {
    const user = userEvent.setup();
    mockApi({
      get: listOk,
      post: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              title: 'Bad Request',
              status: 400,
              detail: 'Target URL failed security verification (SSRF Protection): private address',
              code: 'VALIDATION_ERROR',
            }),
            { status: 400 },
          ),
        ),
    });
    renderPage();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Create subscription' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('SSRF Protection');
    // Nothing was created, so no secret is shown and the form stays open for a fix.
    expect(screen.queryByRole('region', { name: 'Signing secret' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });

  it('prefers the specific field errors over the generic detail', async () => {
    const user = userEvent.setup();
    mockApi({
      get: listOk,
      post: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              detail: 'One or more validation constraints failed.',
              errors: ['name too long', 'targetUrl must be a URL address'],
            }),
            { status: 400 },
          ),
        ),
    });
    renderPage();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Create subscription' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'name too long; targetUrl must be a URL address',
    );
  });

  it('closes the form on cancel without calling the API', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({ get: listOk });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /New subscription/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});

describe('Editing and disabling', () => {
  it('prefills the form and sends only the changed fields', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      get: listOk,
      patch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ ...subscriptionFixture, name: 'Renamed' }), {
            status: 200,
          }),
        ),
    });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit Billing hook' }));

    expect(screen.getByLabelText('Name')).toHaveValue('Billing hook');
    expect(screen.getByLabelText('Event types')).toHaveValue('order.created, payment.succeeded');
    expect(screen.getByLabelText(/Rate limit/)).toHaveValue('50');

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByLabelText('Name')).not.toBeInTheDocument());
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(patch[0]).toBe(`/v1/subscriptions/${subscriptionFixture.id}`);
    expect(bodyOf(patch)).toEqual({ name: 'Renamed' });
    // Editing never shows a signing secret.
    expect(screen.queryByRole('region', { name: 'Signing secret' })).not.toBeInTheDocument();
  });

  it('does not call the API when nothing changed', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({ get: listOk });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit Billing hook' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('disables an active subscription and reloads the list', async () => {
    const user = userEvent.setup();
    let disabled = false;
    const fetchMock = mockApi({
      get: () =>
        Promise.resolve(subscriptionsResponse([{ ...subscriptionFixture, isActive: !disabled }])),
      patch: () => {
        disabled = true;
        return Promise.resolve(
          new Response(JSON.stringify({ ...subscriptionFixture, isActive: false }), {
            status: 200,
          }),
        );
      },
    });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Disable Billing hook' }));

    expect(await screen.findByText('Disabled')).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(bodyOf(patch)).toEqual({ isActive: false });
    expect(screen.getByRole('button', { name: 'Enable Billing hook' })).toBeInTheDocument();
  });

  it('keeps the list and reports a failed toggle', async () => {
    const user = userEvent.setup();
    mockApi({
      get: listOk,
      patch: () => Promise.resolve(new Response('{}', { status: 404 })),
    });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Disable Billing hook' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('does not exist');
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});
