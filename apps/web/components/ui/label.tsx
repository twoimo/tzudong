import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";

type LabelProps = React.ComponentPropsWithoutRef<"label"> & {
  asChild?: boolean;
};

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ asChild = false, className, onMouseDown, ...props }, ref) => {
    const Component = asChild ? Slot : "label";

    return (
      <Component
        ref={ref}
        className={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)}
        {...props}
        onMouseDown={(event) => {
          // Preserve label activation without selecting its text on repeated clicks.
          if ((event.target as HTMLElement).closest("button, input, select, textarea")) return;
          onMouseDown?.(event);
          if (!event.defaultPrevented && event.detail > 1) event.preventDefault();
        }}
      />
    );
  },
);
Label.displayName = "Label";

export { Label };
