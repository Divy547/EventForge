import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Explainer } from '@/components/landing/Explainer';
import { FeatureCards } from '@/components/landing/FeatureCards';
import { LoginForm } from '@/components/landing/LoginForm';
import { SandboxButton } from '@/components/landing/SandboxButton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface LandingProps {
  onSignedIn: (apiKey: string) => void;
  /** Called with the key of a freshly started sandbox session. */
  onSandboxStarted: (apiKey: string) => void;
}

export function Landing({ onSignedIn, onSandboxStarted }: LandingProps) {
  return (
    <div className="min-h-screen">
      <header className="bg-navy text-navy-foreground">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <span className="font-heading text-lg font-semibold">EventForge</span>
          <ThemeToggle />
        </div>
        <div className="mx-auto grid max-w-5xl gap-10 px-4 pt-6 pb-12 lg:grid-cols-[1fr_22rem] lg:items-start">
          <div>
            <h1 className="text-4xl leading-tight font-bold">Webhook delivery you can watch.</h1>
            <p className="mt-3 max-w-xl text-lg text-white/80">
              EventForge takes your events, delivers them to every subscribed endpoint, retries what
              fails, and keeps a dead-letter queue for what cannot be delivered.
            </p>
            <SandboxButton onStarted={(session) => onSandboxStarted(session.apiKey)} />
          </div>
          <Card className="text-card-foreground">
            <CardHeader>
              <CardTitle className="font-heading text-lg">Sign in</CardTitle>
              <CardDescription>Use the API key of your project.</CardDescription>
            </CardHeader>
            <CardContent>
              <LoginForm onSignedIn={onSignedIn} />
            </CardContent>
          </Card>
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-14">
          <Explainer />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-12">
        <h2 className="mb-6 text-xl font-semibold">What you get</h2>
        <FeatureCards />
      </main>
    </div>
  );
}
