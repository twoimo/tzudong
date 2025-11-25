import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, useSpring } from 'framer-motion';
import { cn } from '@/lib/utils';

type Season = 'spring' | 'summer' | 'autumn' | 'winter';

interface SeasonalLogoProps {
    className?: string;
}

const SeasonalLogo: React.FC<SeasonalLogoProps> = ({ className }) => {
    const [season, setSeason] = useState<Season>('spring');
    const containerRef = useRef<HTMLDivElement>(null);

    // Mouse tracking for parallax
    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);

    // Smooth spring physics for mouse movement
    const springConfig = { damping: 25, stiffness: 120 };
    const springX = useSpring(mouseX, springConfig);
    const springY = useSpring(mouseY, springConfig);

    // Parallax transforms
    const layer1X = useTransform(springX, [-0.5, 0.5], [10, -10]); // Far mountains (slow)
    const layer2X = useTransform(springX, [-0.5, 0.5], [20, -20]); // Mid mountains
    const layer3X = useTransform(springX, [-0.5, 0.5], [40, -40]); // Close mountains (fast)

    const layer1Y = useTransform(springY, [-0.5, 0.5], [5, -5]);
    const layer2Y = useTransform(springY, [-0.5, 0.5], [10, -10]);
    const layer3Y = useTransform(springY, [-0.5, 0.5], [15, -15]);

    useEffect(() => {
        const month = new Date().getMonth();
        if (month >= 2 && month <= 4) setSeason('spring');
        else if (month >= 5 && month <= 7) setSeason('summer');
        else if (month >= 8 && month <= 10) setSeason('autumn');
        else setSeason('winter');
    }, []);

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!containerRef.current) return;
        const { width, height, left, top } = containerRef.current.getBoundingClientRect();

        // Normalize coordinates to -0.5 to 0.5
        const x = (e.clientX - left) / width - 0.5;
        const y = (e.clientY - top) / height - 0.5;

        mouseX.set(x);
        mouseY.set(y);
    };

    const handleMouseLeave = () => {
        mouseX.set(0);
        mouseY.set(0);
    };

    // SVG Paths for "Living Ink" Landscape
    const svgs = {
        petal: "M12 2C12 2 10 0 8 0C5 0 2 2 2 5C2 8 5 10 8 10C10 10 12 8 12 8V2Z",
        leaf: "M12.0002 2.00024C12.0002 2.00024 13.5002 7.50024 13.5002 7.50024L18.5002 5.50024L16.5002 10.5002L21.5002 13.0002L16.0002 15.5002L16.0002 21.0002L12.0002 18.5002L8.00024 21.0002L8.00024 15.5002L2.50024 13.0002L7.50024 10.5002L5.50024 5.50024L10.5002 7.50024C10.5002 7.50024 12.0002 2.00024 12.0002 2.00024Z",
        snowflake: "M12 2V22M2 12H22M5 5L19 19M5 19L19 5",
        // Layered Mountains
        mountainFar: "M0,60 Q40,40 80,55 T160,45 T240,55 T320,40 V100 H0 Z",
        mountainMid: "M0,100 L0,50 Q60,30 120,60 T240,40 T360,70 V100 Z",
        mountainClose: "M0,100 L0,70 Q80,40 160,80 T320,60 T480,90 V100 Z",
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
                                    "absolute pointer-events-none select-none",
                                    i % 3 === 0 ? "text-xl blur-[0.5px]" : "text-lg", // Reduced size
                                    i % 5 === 0 ? "text-xl" : "" // Occasional large
                                )}
                                initial={{ opacity: 0, y: -20, x: Math.random() * 100 }}
                                animate={{
                                    opacity: [0, 1, 0],
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
        <div
            ref={containerRef}
            className={cn("relative w-full h-full flex items-center justify-center group overflow-hidden select-none", className)}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
        >
            {/* --- Parallax Landscape Layers --- */}

            {/* Layer 1: Far Mountains (Faint, Slow) */}
            <motion.div
                className="absolute inset-x-[-10%] bottom-0 h-24 opacity-5 pointer-events-none"
                style={{ x: layer1X, y: layer1Y }}
            >
                <svg viewBox="0 0 320 100" preserveAspectRatio="none" className="w-full h-full fill-stone-900">
                    <path d={svgs.mountainFar} />
                </svg>
            </motion.div>

            {/* Mist Layer 1 */}
            <motion.div
                className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-white/40 to-transparent pointer-events-none"
                animate={{ opacity: [0.3, 0.5, 0.3], x: [-10, 10, -10] }}
                transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Layer 2: Mid Mountains (Darker, Medium Speed) */}
            <motion.div
                className="absolute inset-x-[-10%] bottom-0 h-20 opacity-10 pointer-events-none"
                style={{ x: layer2X, y: layer2Y }}
            >
                <svg viewBox="0 0 360 100" preserveAspectRatio="none" className="w-full h-full fill-stone-900">
                    <path d={svgs.mountainMid} />
                </svg>
            </motion.div>

            {/* Mist Layer 2 */}
            <motion.div
                className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white/30 to-transparent pointer-events-none"
                animate={{ opacity: [0.2, 0.4, 0.2], x: [10, -10, 10] }}
                transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            />

            {/* Layer 3: Foreground Mountains (Darkest, Fast) */}
            <motion.div
                className="absolute inset-x-[-10%] bottom-[-10px] h-16 opacity-15 pointer-events-none"
                style={{ x: layer3X, y: layer3Y }}
            >
                <svg viewBox="0 0 480 100" preserveAspectRatio="none" className="w-full h-full fill-stone-900">
                    <path d={svgs.mountainClose} />
                </svg>
            </motion.div>

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
                            alt="쯔동여지도"
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
