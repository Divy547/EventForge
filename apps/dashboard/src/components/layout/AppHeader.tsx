import { NavLink } from 'react-router';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AppHeaderProps {
  onSignOut: () => void;
}

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/events', label: 'Events', end: false },
  { to: '/deliveries', label: 'Deliveries', end: false },
];

/** Dark navy chrome shared by every signed-in page. */
export function AppHeader({ onSignOut }: AppHeaderProps) {
  return (
    <header className="bg-navy text-navy-foreground">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6">
          <span className="font-heading text-lg font-semibold">EventForge</span>
          <nav aria-label="Main" className="flex gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'inline-flex h-11 items-center rounded-md px-3 text-sm font-medium outline-none hover:bg-white/10 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    isActive ? 'bg-white/10 text-white' : 'text-navy-foreground/80',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
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
