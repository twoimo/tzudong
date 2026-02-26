import { RESTAURANT_CATEGORIES } from '@/constants/categories';

const KNOWN_CATEGORIES = [...RESTAURANT_CATEGORIES].sort((a, b) => b.length - a.length);

const addValuesToSet = (target: Set<string>, values: unknown[]) => {
    values.forEach((value) => {
        if (typeof value !== 'string') return;
        const text = value.trim();
        if (!text) return;
        if (!target.has(text)) {
            target.add(text);
        }
    });
};

const splitByKnownCategories = (text: string): string[] => {
    const compact = text.replace(/\s+/g, '');
    let cursor = 0;
    const result: string[] = [];

    while (cursor < compact.length) {
        const match = KNOWN_CATEGORIES.find((category) => compact.startsWith(category, cursor));
        if (!match) {
            return [text];
        }
        result.push(match);
        cursor += match.length;
    }

    return result;
};

export const parseCategoryList = (value: unknown): string[] => {
    const normalized = new Set<string>();

    if (Array.isArray(value)) {
        addValuesToSet(normalized, value);
        return Array.from(normalized);
    }

    if (typeof value !== 'string') return [];

    const text = value.trim();
    if (!text) return [];

    if (text.startsWith('[') && text.endsWith(']')) {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
                addValuesToSet(normalized, parsed);
                return Array.from(normalized);
            }
        } catch {
            // JSON 파싱 실패 시 문자열 기반 파싱으로 폴백
        }
    }

    const splitByDelimiter = text.split(/[,;\n|\\/]+/g).map((item) => item.trim()).filter(Boolean);
    if (splitByDelimiter.length > 1) {
        addValuesToSet(normalized, splitByDelimiter);
        return Array.from(normalized);
    }

    const splitByWhitespace = text.split(/\s+/g).map((item) => item.trim()).filter(Boolean);
    if (splitByWhitespace.length > 1) {
        addValuesToSet(normalized, splitByWhitespace);
        return Array.from(normalized);
    }

    addValuesToSet(normalized, splitByKnownCategories(text));
    return Array.from(normalized);
};

export const formatCategoryText = (value: unknown, fallback = '-') => {
    const categories = parseCategoryList(value);
    if (categories.length === 0) return fallback;
    return categories.join(', ');
};
