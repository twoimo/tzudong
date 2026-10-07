import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="skeleton"
      className={cn("block rounded-md bg-muted/40", className)}
      style={{ contain: 'layout style paint' }}
      {...props}
    />
  );
}

export { Skeleton };
