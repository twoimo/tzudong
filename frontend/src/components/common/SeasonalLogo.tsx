import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

type Season = 'spring' | 'summer' | 'autumn' | 'winter';

interface SeasonalLogoProps {
    className?: string;
}

const SeasonalLogo: React.FC<SeasonalLogoProps> = ({ className }) => {
    const [season, setSeason] = useState<Season>('spring');

    useEffect(() => {
        const month = new Date().getMonth();
        if (month >= 2 && month <= 4) setSeason('spring');
        else if (month >= 5 && month <= 7) setSeason('summer');
        else if (month >= 8 && month <= 10) setSeason('autumn');
        else setSeason('winter');
    }, []);

    // SVG Paths for Particles
    const svgs = {
        petal: "M12 2C12 2 10 0 8 0C5 0 2 2 2 5C2 8 5 10 8 10C10 10 12 8 12 8V2Z",
    };

    const renderParticles = () => {
        switch (season) {
            case 'spring': // Apricot (Salgu) - Floating Petals
                return (
                    <>
                        {[...Array(15)].map((_, i) => (
                            <motion.svg
                                key={`spring-${i}`}
                                viewBox="0 0 24 24"
                                className={cn(
                                    "absolute w-4 h-4 fill-rose-200/60 pointer-events-none mix-blend-multiply",
                                    i % 3 === 0 ? "blur-[1px]" : "" // Depth of field
                                )}
                                initial={{ opacity: 0, y: -20, x: Math.random() * 100 }}
                                animate={{
                                    opacity: [0, 0.8, 0],
                                    y: [0, 120],
                                    x: (i % 2 === 0 ? 1 : -1) * 40 + Math.random() * 20,
                                    rotate: [0, 360],
                                }}
                                transition={{
                                    duration: 6 + Math.random() * 4,
                                    repeat: Infinity,
                                    delay: Math.random() * 5,
                                    ease: "linear"
                                }}
                                style={{ left: `${Math.random() * 100}%`, top: -20 }}
                            >
                                <path d={svgs.petal} />
                            </motion.svg>
                        ))}
                    </>
                );
            case 'summer': // Indigo (Jjok) - Rain/Mist
                return (
                    <>
                        {[...Array(25)].map((_, i) => (
                            <motion.div
                                key={`summer-${i}`}
                                className="absolute w-[1px] h-6 bg-slate-500/30 pointer-events-none"
                                initial={{ opacity: 0, y: -20 }}
                                animate={{
                                    opacity: [0, 0.6, 0],
                                    y: [0, 180],
                                }}
                                transition={{
                                    duration: 1 + Math.random(),
                                    repeat: Infinity,
                                    delay: Math.random() * 2,
                                    ease: "linear"
                                }}
                                style={{ left: `${Math.random() * 100}%`, top: -20 }}
                            />
                        ))}
                    </>
                );
            case 'autumn': // Persimmon (Gam) - Falling Leaves
                return (
                    <>
                        {[...Array(12)].map((_, i) => (
                            <motion.div
                                key={`autumn-${i}`}
                                className={cn(
                                    "absolute pointer-events-none select-none sepia-[.5] grayscale-[.3] opacity-80", // Tone down colors
                                    i % 3 === 0 ? "text-xl blur-[0.5px]" : "text-lg", // Reduced size
                                    i % 5 === 0 ? "text-xl" : "" // Occasional large
                                )}
                                initial={{ opacity: 0, y: -20, x: Math.random() * 100 }}
                                animate={{
                                    opacity: [0, 0.6, 0], // Reduced max opacity
                                    y: [0, 160],
                                    x: [0, (i % 2 === 0 ? 40 : -40), 0],
                                    rotate: [0, 45, -45, 180],
                                }}
                                transition={{
                                    duration: 10 + Math.random() * 8, // Slower and more variable duration
                                    repeat: Infinity,
                                    delay: -Math.random() * 20, // Negative delay to start mid-animation
                                    ease: "linear"
                                }}
                                style={{ left: `${Math.random() * 100}%`, top: -30 }}
                            >
                                {i % 2 === 0 ? "🍁" : "🍂"}
                            </motion.div>
                        ))}
                    </>
                );
            case 'winter': // White (Baek) - Snow
                return (
                    <>
                        {[...Array(20)].map((_, i) => (
                            <motion.div
                                key={`winter-${i}`}
                                className={cn(
                                    "absolute bg-stone-200/80 rounded-full pointer-events-none",
                                    i % 3 === 0 ? "w-1.5 h-1.5 blur-[1px]" : "w-1 h-1"
                                )}
                                initial={{ opacity: 0, y: -20, x: Math.random() * 100 }}
                                animate={{
                                    opacity: [0, 0.9, 0],
                                    y: [0, 100],
                                    x: (Math.random() - 0.5) * 40,
                                }}
                                transition={{
                                    duration: 4 + Math.random() * 4,
                                    repeat: Infinity,
                                    delay: Math.random() * 2,
                                    ease: "linear"
                                }}
                                style={{ left: `${Math.random() * 100}%`, top: -20 }}
                            />
                        ))}
                    </>
                );
        }
    };

    return (
        <div className={cn("relative w-full h-full flex items-center justify-center group overflow-hidden select-none", className)}>
            {/* --- Main Content --- */}
            <div className="relative flex items-center justify-center z-10 px-4">
                {/* Main Logo Image Container */}
                <div className="relative">
                    {/* Ink Spread / Reveal Effect Wrapper */}
                    <motion.div
                        initial={{ opacity: 0, filter: "blur(8px)", scale: 0.95 }}
                        animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
                        transition={{ duration: 1.5, ease: "easeOut" }}
                    >
                        {/* Base Logo Image */}
                        <motion.img
                            src="/sidebar-logo.png"
                            alt="쯔동여지도여지도"
                            className="h-14 w-auto object-contain mix-blend-multiply opacity-90 drop-shadow-sm grayscale contrast-125"
                            // Subtle Floating Animation
                            animate={{ y: [0, -2, 0] }}
                            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                        />
                    </motion.div>

                    {/* Ink Bleeding / Breathing Effect Overlay */}
                    <motion.img
                        src="/sidebar-logo.png"
                        alt=""
                        className="absolute inset-0 h-14 w-auto object-contain mix-blend-multiply blur-[2px] opacity-0 pointer-events-none grayscale contrast-125"
                        animate={{ opacity: [0, 0.2, 0], scale: [1, 1.03, 1] }}
                        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
                    />
                </div>
            </div>

            {/* --- Seasonal Particles (Top Layer) --- */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <AnimatePresence>
                    {renderParticles()}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default SeasonalLogo;
