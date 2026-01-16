import React from "react";
import { Trophy, Medal, Award } from "lucide-react";

// --- Types ---
export interface LeaderboardUser {
    id: string;
    username: string;
    rank: number;
    verifiedReviewCount: number;
    totalLikes: number;
}

export interface UserTier {
    name: string;
    color: string;
    bgColor: string;
}

// --- Constants & Helpers ---

export const getRankIcon = (rank: number) => {
    switch (rank) {
        case 1:
            return React.createElement(Trophy, { className: "h-5 w-5 text-yellow-500" });
        case 2:
            return React.createElement(Medal, { className: "h-5 w-5 text-muted-foreground" });
        case 3:
            return React.createElement(Award, { className: "h-5 w-5 text-amber-600" });
        default:
            return rank; // Use simple number return for caller to wrap if needed, or return span?
        // Original returned span. Let's return the component or node.
        // But usually JSX elements.
    }
};

export const getRankIconElement = (rank: number) => {
    switch (rank) {
        case 1:
            return React.createElement(Trophy, { className: "h-5 w-5 text-yellow-500" });
        case 2:
            return React.createElement(Medal, { className: "h-5 w-5 text-muted-foreground" });
        case 3:
            return React.createElement(Award, { className: "h-5 w-5 text-amber-600" });
        default:
            return React.createElement("span", { className: "text-sm font-bold text-muted-foreground" }, rank);
    }
};


export const getUserTier = (reviewCount: number): UserTier => {
    if (reviewCount >= 100) return { name: "👑 마스터", color: "text-purple-600", bgColor: "bg-purple-50" };
    if (reviewCount >= 50) return { name: "💎 다이아몬드", color: "text-blue-600", bgColor: "bg-blue-50" };
    if (reviewCount >= 25) return { name: "🏆 골드", color: "text-yellow-600", bgColor: "bg-yellow-50" };
    if (reviewCount >= 10) return { name: "🥈 실버", color: "text-muted-foreground", bgColor: "bg-muted" };
    if (reviewCount >= 5) return { name: "🥉 브론즈", color: "text-amber-600", bgColor: "bg-amber-50" };
    return { name: "🌱 뉴비", color: "text-green-600", bgColor: "bg-green-50" };
};
