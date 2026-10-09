import { MapPinOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

function MapStatusNotice({ title, description, onRetry }: { title: string; description: string; onRetry?: () => void }) {
    return <div className="flex h-full items-center justify-center bg-background p-4" role="status">
        <div className="max-w-xs space-y-3 text-center">
            <MapPinOff className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="text-sm leading-6 text-muted-foreground">{description}</p>
            {onRetry && <Button variant="outline" onClick={onRetry}>다시 시도</Button>}
        </div>
    </div>;
}

export function MapViewErrorState({ resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) {
    return <MapStatusNotice title="지도를 불러오지 못했어요" description="잠시 후 다시 시도해 주세요." onRetry={resetErrorBoundary} />;
}

export function MapViewMissingApiKeyState() {
    return <MapStatusNotice title="지도를 불러올 수 없어요" description="잠시 후 다시 확인해 주세요." />;
}

export function MapViewGoogleLoadErrorState() {
    return <MapStatusNotice title="해외 지도를 불러오지 못했어요" description="잠시 후 다시 확인해 주세요." />;
}

export function NaverMapLoadErrorState(_props: { message: string }) {
    return <MapStatusNotice title="지도를 불러오지 못했어요" description="잠시 후 다시 확인해 주세요." />;
}
