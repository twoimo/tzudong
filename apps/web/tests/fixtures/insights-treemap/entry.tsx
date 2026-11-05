import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import InsightsClient from '../../../app/insights/insights-client';

const root = document.getElementById('root');
if (!root) throw new Error('Insights fixture root is missing');

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const key = ['insight-treemap', 'all', 'ALL', 'views'];

// Test-owned provider: the product component keeps its normal query contract.
window.insightsFixtureRefetch = async () => {
    await client.refetchQueries({ queryKey: key, exact: true });
};

createRoot(root).render(
    <QueryClientProvider client={client}>
        <main className="h-dvh w-screen overflow-hidden">
            <InsightsClient />
        </main>
    </QueryClientProvider>,
);

declare global {
    interface Window {
        insightsFixtureRefetch: () => Promise<void>;
    }
}
