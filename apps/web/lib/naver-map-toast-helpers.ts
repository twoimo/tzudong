type MapToast = {
    message: string;
    type: 'success' | 'error' | 'info';
    isVisible: boolean;
} | null;

export function buildNaverMapToastTrigger(
    setMapToast: (value: MapToast | ((prev: MapToast) => MapToast)) => void,
) {
    return (message: string, type: 'success' | 'error' | 'info' = 'success') => {
        setMapToast({ message, type, isVisible: true });

        setTimeout(() => {
            setMapToast(prev => prev ? { ...prev, isVisible: false } : null);
        }, 3000);
    };
}
