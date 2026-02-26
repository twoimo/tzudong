import React from 'react';
import { cn } from '@/lib/utils';
import { Plus, Minus } from 'lucide-react';

interface MapZoomSliderProps {
    value: number;
    min?: number;
    max?: number;
    onChange: (value: number) => void;
    className?: string;
}

export const MapZoomSlider = ({
    value,
    min = 0,
    max = 100,
    onChange,
    className
}: MapZoomSliderProps) => {
    // Handle change for vertical slider (top is max)
    // If rotated -90deg, Left is Bottom (Min), Right is Top (Max).

    return (
        <div className={cn("flex flex-col items-center bg-background/90 backdrop-blur rounded-lg shadow-md border border-border py-2 px-1 gap-2", className)}>
            <button
                onClick={() => onChange(Math.min(value + 10, max))}
                className="p-1 hover:bg-muted rounded-md transition-colors"
                aria-label="Zoom In"
            >
                <Plus className="w-4 h-4 text-muted-foreground" />
            </button>

            <div className="relative h-[120px] w-6 flex items-center justify-center">
                <input
                    type="range"
                    min={min}
                    max={max}
                    value={value}
                    onChange={(e) => onChange(Number(e.target.value))}
                    className="absolute w-[120px] h-2 bg-secondary rounded-lg appearance-none cursor-pointer"
                    style={{
                        transform: 'rotate(-90deg)',
                        transformOrigin: 'center',
                    }}
                />
            </div>

            <button
                onClick={() => onChange(Math.max(value - 10, min))}
                className="p-1 hover:bg-muted rounded-md transition-colors"
                aria-label="Zoom Out"
            >
                <Minus className="w-4 h-4 text-muted-foreground" />
            </button>
        </div>
    );
};
