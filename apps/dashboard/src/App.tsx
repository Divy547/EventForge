import { Button } from '@/components/ui/button';

/** Placeholder shell; the login/landing page replaces this in the next task. */
export function App() {
  return (
    <main className="min-h-screen">
      <header className="bg-navy text-navy-foreground">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <span className="font-heading text-lg font-semibold">EventForge</span>
        </div>
      </header>
      <section className="mx-auto max-w-5xl px-4 py-12">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Event delivery, retries and dead letters, in one place.
        </p>
        <Button className="mt-6">Get started</Button>
      </section>
    </main>
  );
}
