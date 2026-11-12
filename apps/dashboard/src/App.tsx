import { useCallback, useState } from 'react';
import { Landing } from '@/pages/Landing';
import { Overview } from '@/pages/Overview';
import { clearApiKey, loadApiKey, saveApiKey } from '@/lib/session';

export function App() {
  // The key is validated by the login form before it gets here, so a stored key is trusted for
  // this tab; the API still rejects it on every request if it has since been revoked.
  const [apiKey, setApiKey] = useState<string | null>(() => loadApiKey());

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
          setApiKey(key);
        }}
      />
    );
  }
  return <Overview apiKey={apiKey} onSignOut={signOut} />;
}
