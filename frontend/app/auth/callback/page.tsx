import { AuthCallbackScreen } from '@/components/auth-callback-screen';

export default async function AuthCallbackPage({ searchParams }: { searchParams: Promise<{ error_description?: string }> }) {
  const { error_description: callbackError } = await searchParams;
  return <AuthCallbackScreen callbackError={callbackError} />;
}
