import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface BrandSectionHeadingProps {
  eyebrow?: string;
  title: ReactNode;
  emoji?: string;
  description?: ReactNode;
  as?: "h1" | "h2";
  size?: "section" | "page";
  className?: string;
}

export function BrandSectionHeading({
  eyebrow,
  title,
  emoji,
  description,
  as: Heading = "h2",
  size = "section",
  className,
}: BrandSectionHeadingProps) {
  return (
    <div className={cn("min-w-0", className)} data-brand-section-heading="true">
      {eyebrow ? <p className="text-2xs font-bold tracking-wide text-brand-garden-text">{eyebrow}</p> : null}
      <Heading
        className={cn(
          "mt-0.5 flex min-w-0 items-center gap-1.5 font-black tracking-tight text-foreground",
          size === "page" ? "text-xl leading-7 md:text-2xl md:leading-8" : "text-base leading-6",
        )}
      >
        <span className="min-w-0 truncate">{title}</span>
        {emoji ? (
          <span aria-hidden="true" className="shrink-0 font-normal">
            {emoji}
          </span>
        ) : null}
      </Heading>
      {description ? (
        <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
