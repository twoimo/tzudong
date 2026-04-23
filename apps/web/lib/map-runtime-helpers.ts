export class LruCache<K, V> {
    private readonly maxSize: number;
    private readonly cache = new Map<K, V>();

    constructor(maxSize = 500) {
        this.maxSize = maxSize;
    }

    get(key: K): V | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }

    set(key: K, value: V) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        this.cache.set(key, value);

        if (this.cache.size > this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }
    }

    has(key: K) {
        return this.cache.has(key);
    }

    get size() {
        return this.cache.size;
    }

    keys() {
        return this.cache.keys();
    }

    delete(key: K) {
        return this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }
}

export function debounce<TArgs extends unknown[], TResult>(
    func: (...args: TArgs) => TResult,
    delay: number
): (...args: TArgs) => void {
    let timeout: NodeJS.Timeout | null = null;
    return (...args: TArgs) => {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
            func(...args);
            timeout = null;
        }, delay);
    };
}
