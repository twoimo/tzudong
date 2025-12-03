'use client';

import React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface SeasonalLogoProps {
    className?: string;
}

const SeasonalLogo: React.FC<SeasonalLogoProps> = ({ className }) => {
    return (
        <div className={cn("relative w-full h-full flex items-center justify-center select-none", className)}>
            {/* Main Logo Image */}
            <div className="relative px-4">
                <Image
                    src="/sidebar-logo.png"
                    alt="쯔동여지도"
                    width={200}
                    height={56}
                    priority
                    sizes="(max-width: 768px) 150px, 200px"
                    className="h-14 w-auto object-contain mix-blend-multiply opacity-90 drop-shadow-sm grayscale contrast-125"
                />
            </div>
        </div>
    );
};

export default SeasonalLogo;
