import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  RISKY_WORK_STEPS,
  type RiskyWorkMenuId,
  type RiskyWorkStep,
} from "@/lib/admin/risky-work-procedure";

export function RiskyWorkProcedureSteps({
  menuId,
  currentStep = "미리보기",
}: {
  menuId: RiskyWorkMenuId;
  currentStep?: RiskyWorkStep;
}) {
  const currentIndex = RISKY_WORK_STEPS.indexOf(currentStep);
  return (
    <div
      className="flex flex-wrap items-center gap-2 px-2 py-1.5"
      data-admin-risky-work-procedure="true"
      data-admin-risky-work-menu={menuId}
      data-admin-risky-work-current-step={currentStep}
    >
      {RISKY_WORK_STEPS.map((step, index) => (
        <div key={step} className="flex items-center gap-2">
          <Badge
            variant={index <= currentIndex ? "default" : "secondary"}
            className={cn(
              index === currentIndex && "bg-primary text-primary-foreground",
            )}
            data-admin-risky-work-step={step}
            data-admin-risky-work-step-state={
              index < currentIndex
                ? "done"
                : index === currentIndex
                  ? "current"
                  : "upcoming"
            }
          >
            {step}
          </Badge>
          {index < RISKY_WORK_STEPS.length - 1 ? (
            <span className="text-muted-foreground">→</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
