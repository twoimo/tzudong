import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { cn } from '@/lib/utils';

type Season = 'spring' | 'summer' | 'autumn' | 'winter';

interface SeasonalLogoProps {
    className?: string;
}

const SeasonalLogo: React.FC<SeasonalLogoProps> = ({ className }) => {
    const [season, setSeason] = useState<Season>('spring');
    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);

    useEffect(() => {
        const month = new Date().getMonth(); // 0-11
        // Spring: 3, 4, 5
        // Summer: 6, 7, 8
        // Autumn: 9, 10, 11
        // Winter: 12, 1, 2

        if (month >= 2 && month <= 4) setSeason('spring');
        else if (month >= 5 && month <= 7) setSeason('summer');
        else if (month >= 8 && month <= 10) setSeason('autumn');
        else setSeason('winter');
    }, []);

    const handleMouseMove = (e: React.MouseEvent) => {
        const { left, top } = e.currentTarget.getBoundingClientRect();
        mouseX.set(e.clientX - left);
        mouseY.set(e.clientY - top);
    };

    // SVG Paths
    const svgs = {
        petal: "M12 2C12 2 10 0 8 0C5 0 2 2 2 5C2 8 5 10 8 10C10 10 12 8 12 8V2Z", // Simplified petal
        leaf: "M12 0L14 4L18 4L15 7L16 11L12 9L8 11L9 7L6 4L10 4L12 0Z", // Maple leaf-ish
        snowflake: "M12 2V22M2 12H22M5 5L19 19M5 19L19 5", // Simple snowflake lines (stroke only)
    };

    const renderParticles = () => {
        switch (season) {
            case 'spring': // Cherry Blossoms (SVG Petals)
                return (
                    <>
                        {[...Array(12)].map((_, i) => (
                            <motion.svg
                                key={`spring-${i}`}
                                viewBox="0 0 24 24"
                                className="absolute w-4 h-4 fill-pink-200/80 pointer-events-none drop-shadow-sm"
                                initial={{ opacity: 0, y: -20, x: Math.random() * 100 }}
                                animate={{
                                    opacity: [0, 1, 1, 0],
                                    y: [0, 100],
                                    x: (i % 2 === 0 ? 1 : -1) * 30 + Math.random() * 20,
                                    rotate: [0, 360],
                                    scale: [0.8, 1, 0.8]
                                }}
                                transition={{
                                    duration: 5 + Math.random() * 3,
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
            case 'summer': // Sun Glare & Heat Haze (Canvas-like feel with divs)
                return (
                    <>
                        {/* Sun Orb */}
                        <motion.div
                            className="absolute -top-10 -right-10 w-32 h-32 bg-gradient-to-br from-yellow-300 to-orange-500 rounded-full blur-2xl opacity-40 pointer-events-none"
                            animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.5, 0.3] }}
                            transition={{ duration: 4, repeat: Infinity }}
                        />
                        {/* Heat Particles */}
                        {[...Array(6)].map((_, i) => (
                            <motion.div
                                key={`summer-${i}`}
                                className="absolute w-2 h-2 bg-yellow-200/60 rounded-full blur-[1px] pointer-events-none"
                                initial={{ opacity: 0, y: 100 }}
                                animate={{
                                    opacity: [0, 0.8, 0],
                                    y: -20,
                                    x: (Math.random() - 0.5) * 40
                                }}
                                transition={{
                                    duration: 3 + Math.random() * 2,
                                    repeat: Infinity,
                                    delay: Math.random() * 2,
                                    ease: "easeOut"
                                }}
                                style={{ left: `${Math.random() * 100}%`, top: '100%' }}
                            />
                        ))}
                    </>
                );
            case 'autumn': // Falling Maple Leaves (SVG)
                return (
                    <>
                        {[...Array(8)].map((_, i) => (
                            <motion.svg
                                key={`autumn-${i}`}
                                viewBox="0 0 24 24"
                                className={cn(
                                    "absolute w-5 h-5 pointer-events-none drop-shadow-md",
                                    i % 2 === 0 ? "fill-orange-500/80" : "fill-red-600/80"
                                )}
                                initial={{ opacity: 0, y: -20, x: Math.random() * 100 }}
                                animate={{
                                    opacity: [0, 1, 1, 0],
                                    y: [0, 120],
                                    x: [0, (i % 2 === 0 ? 20 : -20), 0], // Swaying
                                    rotate: [0, 180, 360],
                                    rotateX: [0, 180, 0], // 3D flip
                                }}
                                transition={{
                                    duration: 6 + Math.random() * 4,
                                    repeat: Infinity,
                                    delay: Math.random() * 5,
                                    ease: "linear"
                                }}
                                style={{ left: `${Math.random() * 100}%`, top: -20 }}
                            >
                                <path d={svgs.leaf} />
                            </motion.svg>
                        ))}
                    </>
                );
            case 'winter': // Snowflakes (SVG Stroke)
                return (
                    <>
                        {[...Array(15)].map((_, i) => (
                            <motion.svg
                                key={`winter-${i}`}
                                viewBox="0 0 24 24"
                                className="absolute w-3 h-3 stroke-white/80 pointer-events-none drop-shadow-[0_0_2px_rgba(255,255,255,0.8)]"
                                fill="none"
                                strokeWidth="2"
                                strokeLinecap="round"
                                initial={{ opacity: 0, y: -20, x: Math.random() * 100 }}
                                animate={{
                                    opacity: [0, 1, 0],
                                    y: [0, 100],
                                    x: (Math.random() - 0.5) * 30,
                                    rotate: [0, 180]
                                }}
                                transition={{
                                    duration: 4 + Math.random() * 3,
                                    repeat: Infinity,
                                    delay: Math.random() * 2,
                                    ease: "linear"
                                }}
                                style={{ left: `${Math.random() * 100}%`, top: -20 }}
                            >
                                <path d={svgs.snowflake} />
                            </motion.svg>
                        ))}
                    </>
                );
        }
    };

    const getSeasonStyle = () => {
        switch (season) {
            case 'spring':
                return {
                    // Pink to Rose gradient
                    text: 'bg-gradient-to-r from-pink-400 via-rose-400 to-pink-500 bg-clip-text text-transparent',
                    shadow: 'drop-shadow-[0_2px_10px_rgba(244,114,182,0.3)]',
                    glow: 'from-pink-300/20 via-rose-300/10 to-transparent'
                };
            case 'summer':
                return {
                    // Amber to Orange gradient
                    text: 'bg-gradient-to-r from-amber-400 via-orange-500 to-amber-500 bg-clip-text text-transparent',
                    shadow: 'drop-shadow-[0_2px_10px_rgba(245,158,11,0.4)]',
                    glow: 'from-amber-300/20 via-orange-300/10 to-transparent'
                };
            case 'autumn':
                return {
                    // Red to Brown/Orange gradient
                    text: 'bg-gradient-to-r from-orange-500 via-red-600 to-orange-600 bg-clip-text text-transparent',
                    shadow: 'drop-shadow-[0_2px_10px_rgba(220,38,38,0.3)]',
                    glow: 'from-orange-300/20 via-red-300/10 to-transparent'
                };
            case 'winter':
                return {
                    // Sky to Blue gradient
                    text: 'bg-gradient-to-r from-sky-300 via-blue-500 to-sky-400 bg-clip-text text-transparent',
                    shadow: 'drop-shadow-[0_2px_10px_rgba(14,165,233,0.4)]',
                    glow: 'from-sky-300/20 via-blue-300/10 to-transparent'
                };
            default:
                return { text: 'text-stone-900', shadow: '', glow: '' };
        }
    };

    const style = getSeasonStyle();

    return (
        <div
            className={cn("relative w-full h-full flex items-center justify-center group overflow-hidden bg-stone-50/50", className)}
            onMouseMove={handleMouseMove}
        >
            {/* Ambient Background Glow */}
            <div className={cn("absolute inset-0 bg-gradient-to-b opacity-0 group-hover:opacity-100 transition-opacity duration-700", style.glow)} />

            {/* Main Text */}
            <motion.h1
                className={cn(
                    "text-4xl tracking-wide relative z-10 font-bold select-none",
                    style.text,
                    style.shadow
                )}
                style={{ fontFamily: "'ChosunCentennial', cursive" }}
                animate={{
                    scale: [1, 1.02, 1],
                    filter: ["brightness(1)", "brightness(1.1)", "brightness(1)"]
                }}
                transition={{
                    duration: 5,
                    repeat: Infinity,
                    ease: "easeInOut"
                }}
            >
                쯔동여지도
            </motion.h1>

            {/* Shimmer Overlay on Text */}
            <motion.div
                className="absolute inset-0 z-20 pointer-events-none mix-blend-overlay"
                style={{
                    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)",
                    backgroundSize: "200% 100%"
                }}
                animate={{ backgroundPosition: ["200% 0", "-200% 0"] }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear", repeatDelay: 2 }}
            />

            {/* Seasonal Particles */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <AnimatePresence>
                    {renderParticles()}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default SeasonalLogo;
