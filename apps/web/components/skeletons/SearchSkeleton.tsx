import { Skeleton } from "@/components/ui/skeleton";

export function SearchSkeleton() {
    return (
        <div className="relative w-72 h-10">
            <Skeleton className="w-full h-full rounded-md" />
            <div className="absolute left-3 top-1/2 -translate-y-1/2">
                <Skeleton className="w-4 h-4 rounded-full bg-muted-foreground/20" />
            </div>
        </div>
    );
}
