import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, vi } from 'vitest';
import { App } from './App';
import { eventsPage, statsResponse } from './test/fixtures';
import { renderAt } from './test/render';

function mockFetch(status: number) {
  const fetchMock = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(status === 200 ? statsResponse() : new Response('{}', { status })),
    );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

async function submitKey(key: string) {
  const user = userEvent.setup();
  if (key) await user.type(screen.getByLabelText('Project API key'), key);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('Landing and login', () => {
  it('shows the headline, sign-in form and the four feature cards', () => {
    renderAt(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Webhook delivery');
    expect(screen.getByLabelText('Project API key')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dead-letter queue' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(4);
  });

  it('accepts a valid key, sends it as X-API-Key, and keeps it in sessionStorage only', async () => {
    const fetchMock = mockFetch(200);
    renderAt(<App />);
    await submitKey('  ef_live_abc  ');

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/stats?windowHours=1',
      expect.objectContaining({ headers: { 'X-API-Key': 'ef_live_abc' } }),
    );
    expect(window.sessionStorage.getItem('eventforge.apiKey')).toBe('ef_live_abc');
    expect(window.localStorage.length).toBe(0);
  });

  it('rejects an invalid key with an error and stores nothing', async () => {
    mockFetch(401);
    renderAt(<App />);
    await submitKey('wrong');

    expect(await screen.findByRole('alert')).toHaveTextContent('was not accepted');
    expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();
    expect(window.sessionStorage.length).toBe(0);
  });

  it('asks for a key instead of calling the API when the field is empty', async () => {
    const fetchMock = mockFetch(200);
    renderAt(<App />);
    await submitKey('');

    expect(screen.getByRole('alert')).toHaveTextContent('Paste your project API key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tells the visitor when the API cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
    renderAt(<App />);
    await submitKey('some-key');

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the API');
    expect(window.sessionStorage.length).toBe(0);
  });

  it('reports rate limiting distinctly from a bad key', async () => {
    mockFetch(429);
    renderAt(<App />);
    await submitKey('some-key');

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
  });

  it('skips the landing page when a key is already stored, and sign-out clears it', async () => {
    window.sessionStorage.setItem('eventforge.apiKey', 'ef_live_abc');
    renderAt(<App />);
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByLabelText('Project API key')).toBeInTheDocument());
    expect(window.sessionStorage.getItem('eventforge.apiKey')).toBeNull();
  });

  it('still works for this page view when sessionStorage throws', async () => {
    mockFetch(200);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderAt(<App />);
    await submitKey('ef_live_abc');

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('keeps a deep link through sign-in and navigates between pages from the header', async () => {
    window.sessionStorage.setItem('eventforge.apiKey', 'ef_live_abc');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(url.startsWith('/v1/stats') ? statsResponse() : eventsPage()),
        ),
    );
    const user = userEvent.setup();
    renderAt(<App />, '/events');

    expect(await screen.findByRole('heading', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Events' })).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('link', { name: 'Overview' }));
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
  });

  it('sends unknown paths to the Overview', async () => {
    window.sessionStorage.setItem('eventforge.apiKey', 'ef_live_abc');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statsResponse()));
    renderAt(<App />, '/nowhere');
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
  });
});

describe('Try the live sandbox', () => {
  const sessionResponse = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({ apiKey: 'ef_live_sandbox', expiresAt: '2026-11-12T13:00:00Z' }),
        {
          status: 201,
        },
      ),
    );

  it('starts a session without asking for a key and lands on the sandbox page', async () => {
    const fetchMock = vi.fn().mockImplementation(sessionResponse);
    vi.stubGlobal('fetch', fetchMock);
    renderAt(<App />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Try the live sandbox' }));

    expect(await screen.findByRole('heading', { name: 'Sandbox' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/sandbox/session',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('/sandbox');
    expect(window.sessionStorage.getItem('eventforge.apiKey')).toBe('ef_live_sandbox');
    expect(screen.getByRole('link', { name: 'Sandbox' })).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
  });

  it('does not show the Sandbox link to a visitor who signed in with their own key', async () => {
    mockFetch(200);
    renderAt(<App />);
    await submitKey('ef_live_abc');
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sandbox' })).not.toBeInTheDocument();
  });

  it.each([
    [404, 'not available on this server'],
    [429, 'Too many sandbox sessions'],
    [500, 'unexpected error'],
  ])('explains a %i from the API', async (status, text) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    renderAt(<App />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try the live sandbox' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('says so when the API cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')));
    renderAt(<App />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try the live sandbox' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the API');
  });
});
