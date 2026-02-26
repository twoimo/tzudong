import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-md bg-muted/40", className)} style={{ contain: 'layout style paint' }} {...props} />;
}

export { Skeleton };
