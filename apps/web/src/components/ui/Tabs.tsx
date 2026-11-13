import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/utils';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <TabsPrimitive.List
      className={cn(
        'glass-flat inline-flex w-full max-w-full flex-wrap items-center gap-1 rounded-btn p-1.5',
        className,
      )}
    >
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({
  value,
  children,
  className,
  disabled,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-btn px-4 py-2 text-sm font-medium text-moonlight transition-colors duration-300',
        'hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
        'data-[state=active]:bg-white/12 data-[state=active]:text-white data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <TabsPrimitive.Content
      value={value}
      className={cn('mt-6 focus-visible:outline-none', className)}
    >
      {children}
    </TabsPrimitive.Content>
  );
}
