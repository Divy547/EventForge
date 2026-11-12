import { Button } from '@/components/ui/button';

interface AppHeaderProps {
  onSignOut: () => void;
}

/** Dark navy chrome shared by every signed-in page. */
export function AppHeader({ onSignOut }: AppHeaderProps) {
  return (
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
  );
}
