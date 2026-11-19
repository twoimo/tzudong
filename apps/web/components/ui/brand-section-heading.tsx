import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface BrandSectionHeadingProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  as?: "h1" | "h2";
  size?: "section" | "page";
  className?: string;
}

export function BrandSectionHeading({
  eyebrow,
  title,
  description,
  as: Heading = "h2",
  size = "section",
  className,
}: BrandSectionHeadingProps) {
  return (
    <div className={cn("min-w-0", className)} data-brand-section-heading="true">
      {eyebrow ? <p className="mb-1 text-xs font-medium text-muted-foreground">{eyebrow}</p> : null}
      <Heading
        className={cn(
          "min-w-0 font-semibold text-foreground",
          size === "page" ? "text-xl leading-7 md:text-2xl md:leading-8" : "text-base leading-6",
        )}
      >
        {title}
      </Heading>
      {description ? (
        <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
