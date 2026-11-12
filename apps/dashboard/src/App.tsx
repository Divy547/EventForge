import { useCallback, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router';
import { Landing } from '@/pages/Landing';
import { DeliveryDetail } from '@/pages/DeliveryDetail';
import { DeadLetters } from '@/pages/DeadLetters';
import { Deliveries } from '@/pages/Deliveries';
import { EventDetail } from '@/pages/EventDetail';
import { Events } from '@/pages/Events';
import { Overview } from '@/pages/Overview';
import { Sandbox } from '@/pages/Sandbox';
import { Subscriptions } from '@/pages/Subscriptions';
import { clearApiKey, loadApiKey, saveApiKey, saveSandboxFlag } from '@/lib/session';

export function App() {
  // The key is validated by the login form before it gets here, so a stored key is trusted for
  // this tab; the API still rejects it on every request if it has since been revoked.
  const [apiKey, setApiKey] = useState<string | null>(() => loadApiKey());
  const navigate = useNavigate();

  // Stable identity: Overview refetches when its callbacks change.
  const signOut = useCallback(() => {
    clearApiKey();
    setApiKey(null);
  }, []);

  if (!apiKey) {
    return (
      <Landing
        onSignedIn={(key) => {
          saveApiKey(key);
          saveSandboxFlag(false);
          setApiKey(key);
        }}
        onSandboxStarted={(key) => {
          saveApiKey(key);
          saveSandboxFlag(true);
          setApiKey(key);
          navigate('/sandbox');
        }}
      />
    );
  }
  // Signing in keeps the URL, so a deep link such as /dashboard/events/<id> works after login.
  return (
    <Routes>
      <Route path="/" element={<Overview apiKey={apiKey} onSignOut={signOut} />} />
      <Route path="/events" element={<Events apiKey={apiKey} onSignOut={signOut} />} />
      <Route path="/events/:id" element={<EventDetail apiKey={apiKey} onSignOut={signOut} />} />
      <Route path="/deliveries" element={<Deliveries apiKey={apiKey} onSignOut={signOut} />} />
      <Route
        path="/deliveries/:id"
        element={<DeliveryDetail apiKey={apiKey} onSignOut={signOut} />}
      />
      <Route path="/dead-letters" element={<DeadLetters apiKey={apiKey} onSignOut={signOut} />} />
      <Route
        path="/subscriptions"
        element={<Subscriptions apiKey={apiKey} onSignOut={signOut} />}
      />
      <Route path="/sandbox" element={<Sandbox apiKey={apiKey} onSignOut={signOut} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
