import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Suppress development warnings in development mode
if (import.meta.env.DEV) {
    // Use a more aggressive approach to suppress warnings
    const originalWarn = console.warn.bind(console);
    const originalLog = console.log.bind(console);
    const originalError = console.error.bind(console);

    // Override console methods with filtering
    Object.defineProperty(console, 'warn', {
        value: (...args: any[]) => {
            const message = args.join(' ');
            // Filter out React Router future flag warnings
            if (message.includes('React Router Future Flag Warning') ||
                message.includes('v7_startTransition') ||
                message.includes('v7_relativeSplatPath')) {
                return;
            }
            // Filter out Naver Maps API passive event listener warnings
            if (message.includes('Added non-passive event listener to a scroll-blocking')) {
                return;
            }
            originalWarn(...args);
        },
        configurable: true,
        enumerable: true
    });

    Object.defineProperty(console, 'log', {
        value: (...args: any[]) => {
            const message = args.join(' ');
            // Filter out React DevTools download message
            if (message.includes('Download the React DevTools')) {
                return;
            }
            // Filter out external extension messages
            if (message.includes('Nightly Wallet Injected Successfully') ||
                message.includes('Nightly: Overwrites EVM default provider')) {
                return;
            }
            originalLog(...args);
        },
        configurable: true,
        enumerable: true
    });

    // Override console.error to filter browser violations
    Object.defineProperty(console, 'error', {
        value: (...args: any[]) => {
            const message = args.join(' ');
            // Filter out browser violation warnings
            if (message.includes('[Violation]') &&
                (message.includes('Added non-passive event listener') ||
                    message.includes('passive'))) {
                return;
            }
            originalError(...args);
        },
        configurable: true,
        enumerable: true
    });

    // Override console.warn to catch all remaining violations
    Object.defineProperty(console, 'warn', {
        value: (...args: any[]) => {
            const message = args.join(' ');
            // Filter out React Router future flag warnings
            if (message.includes('React Router Future Flag Warning') ||
                message.includes('v7_startTransition') ||
                message.includes('v7_relativeSplatPath')) {
                return;
            }
            // Filter out Naver Maps API passive event listener warnings
            if (message.includes('Added non-passive event listener to a scroll-blocking')) {
                return;
            }
            // Filter out DOM warnings
            if (message.includes('Input elements should have autocomplete attributes')) {
                return;
            }
            originalWarn(...args);
        },
        configurable: true,
        enumerable: true
    });
}

// 새로고침 시 앱 상태 모니터링 (디버깅용)
if (import.meta.env.DEV) {
    console.log('🚀 App starting...', new Date().toISOString());

    // 페이지 로드 완료 시점 로깅
    window.addEventListener('load', () => {
        console.log('✅ App loaded successfully');
    });

    // 새로고침 또는 페이지 이동 시 로깅
    window.addEventListener('beforeunload', () => {
        console.log('🔄 Page unloading (refresh or navigation)');
    });

    // 새로고침 감지 및 로깅
    let isRefreshing = false;
    const originalLocation = window.location.href;

    setInterval(() => {
        if (window.location.href !== originalLocation && !isRefreshing) {
            isRefreshing = true;
            console.log('🔄 Page refresh/navigation detected');
            setTimeout(() => { isRefreshing = false; }, 1000);
        }
    }, 500);
}

createRoot(document.getElementById("root")!).render(<App />);
