import { Dashboard } from '@/components/dashboard';

export default async function AppPage({ searchParams }: { searchParams: Promise<{ intent?: string; view?: string }> }) {
  const { intent, view } = await searchParams;
  const initialView = view === 'explore' || view === 'owned' || view === 'applications' ? view : undefined;
  return <Dashboard initialIntent={intent === 'create' || intent === 'explore' ? intent : undefined} initialView={initialView} />;
}
