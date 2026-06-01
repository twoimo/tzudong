import { StampPageSkeleton } from "@/components/ui/skeleton-loaders";

/**
 * Mobile stamp navigation can otherwise show a blank segment while the large
 * client page bundle and restaurant data path are prepared. Keep this fallback
 * route-owned and lightweight so users get immediate layout feedback.
 */
export default function StampLoading() {
    return <StampPageSkeleton />;
}
