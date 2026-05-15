import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted/40 motion-reduce:animate-none", className)}
      style={{ contain: 'layout style paint' }}
      {...props}
    />
  );
}

export { Skeleton };
