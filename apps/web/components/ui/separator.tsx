import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";

type SeparatorProps = React.ComponentPropsWithoutRef<"div"> & {
  asChild?: boolean;
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
};

const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  ({ asChild = false, className, orientation = "horizontal", decorative = true, ...props }, ref) => {
    const Component = asChild ? Slot : "div";
    const resolvedOrientation = orientation === "vertical" ? "vertical" : "horizontal";

    return (
      <Component
        ref={ref}
        data-orientation={resolvedOrientation}
        role={decorative ? "none" : "separator"}
        aria-orientation={!decorative && resolvedOrientation === "vertical" ? "vertical" : undefined}
        className={cn("shrink-0 bg-border", orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]", className)}
        {...props}
      />
    );
  },
);
Separator.displayName = "Separator";

export { Separator };
