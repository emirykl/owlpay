'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { WalletProvider } from './wallet-provider';
import { AuthProvider } from './auth-provider';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <AuthProvider>
      <WalletProvider>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </WalletProvider>
    </AuthProvider>
  );
}
