import { Button } from '@/components/ui/button';

interface SignedInProps {
  onSignOut: () => void;
}

/** Temporary home for a signed-in visitor; the Overview page replaces it in the next task. */
export function SignedIn({ onSignOut }: SignedInProps) {
  return (
    <div className="min-h-screen">
      <header className="bg-navy text-navy-foreground">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <span className="font-heading text-lg font-semibold">EventForge</span>
          <Button
            variant="outline"
            onClick={onSignOut}
            className="border-white/30 bg-transparent text-navy-foreground hover:bg-white/10 hover:text-navy-foreground"
          >
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-12">
        <h1 className="text-3xl font-bold">You are signed in</h1>
        <p className="mt-2 text-muted-foreground">Your project overview is coming next.</p>
      </main>
    </div>
  );
}
