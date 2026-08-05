import { Dashboard } from '@/components/dashboard';

export default async function AppPage({ searchParams }: { searchParams: Promise<{ intent?: string }> }) {
  const { intent } = await searchParams;
  return <Dashboard initialIntent={intent === 'create' || intent === 'explore' ? intent : undefined} />;
}
