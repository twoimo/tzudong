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

createRoot(document.getElementById("root")!).render(<App />);
