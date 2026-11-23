'use client';

import dynamic from 'next/dynamic';

const ProviderClient = dynamic(() => import('./ProviderClient'), {
  ssr: false,
});

export default function CipherGateProviderPage() {
  return <ProviderClient />;
}