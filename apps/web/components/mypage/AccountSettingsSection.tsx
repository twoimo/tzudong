import type { ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";

interface AccountSettingsSectionProps {
  title: string;
  description: string;
  icon: LucideIcon;
  children: ReactNode;
}

export function AccountSettingsSection({
  title,
  description,
  icon: Icon,
  children,
}: AccountSettingsSectionProps) {
  return (
    <details className="group/settings">
      <summary className="flex min-h-11 cursor-pointer touch-manipulation list-none items-center gap-3 rounded-xl p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          <span className="block text-xs leading-5 text-muted-foreground">{description}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-open/settings:rotate-90" strokeWidth={1.5} aria-hidden="true" />
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}
