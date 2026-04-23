import type { LucideIcon } from 'lucide-react';

type Props = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void } | undefined;
};

export function EmptyState({ icon: Icon, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background py-16 px-8 text-center">
      {Icon && <Icon className="mx-auto h-10 w-10 text-muted-foreground mb-4" strokeWidth={1.5} />}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1 text-xs text-muted-foreground max-w-xs">{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
