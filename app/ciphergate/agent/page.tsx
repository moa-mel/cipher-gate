'use client';

import dynamic from 'next/dynamic';

const AgentClient = dynamic(() => import('./AgentClient'), {
  ssr: false,
});

export default function CipherGateAgentPage() {
  return <AgentClient />;
}