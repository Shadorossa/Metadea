'use client';

import { useState } from 'react';

export default function Home() {
  const [status, setStatus] = useState('');

  const testBackend = async () => {
    try {
      const res = await fetch('http://localhost:8787/api/health');
      const data = await res.json();
      setStatus(`✅ Backend: ${JSON.stringify(data)}`);
    } catch (err) {
      setStatus(`❌ Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
      <div className="text-center">
        <h1 className="text-5xl font-bold mb-4">🎬 Metamedia</h1>
        <p className="text-gray-400 mb-8">Tu backlog personal offline</p>
        <button onClick={testBackend} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded font-semibold">
          Test Backend
        </button>
        {status && <div className="mt-4 p-4 bg-gray-800 rounded text-sm font-mono">{status}</div>}
      </div>
    </main>
  );
}
