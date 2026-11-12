import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Outline style: transparent with a border, filling in on hover. A pressed toggle (aria-pressed)
        // is the one resting state that is filled.
        default:
          'border border-primary bg-transparent text-primary hover:bg-primary hover:text-primary-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground',
        destructive:
          'border border-destructive bg-transparent text-destructive hover:bg-destructive hover:text-white focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        outline:
          'border border-input bg-transparent hover:border-primary hover:bg-accent hover:text-accent-foreground',
        secondary:
          'border border-border bg-transparent text-secondary-foreground hover:bg-secondary',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline underline-offset-4 hover:no-underline',
      },
      size: {
        // Every size keeps a 44px minimum touch target.
        default: 'h-11 px-4 py-2 has-[>svg]:px-3',
        lg: 'h-12 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
