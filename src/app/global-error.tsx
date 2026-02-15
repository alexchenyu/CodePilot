'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>
        <h2>Something went wrong</h2>
        <pre style={{ 
          whiteSpace: 'pre-wrap', 
          wordBreak: 'break-all', 
          background: '#f0f0f0', 
          padding: 12, 
          borderRadius: 8,
          fontSize: 13,
          maxHeight: '60vh',
          overflow: 'auto',
        }}>
          {error.message}
          {'\n\n'}
          {error.stack}
        </pre>
        <button
          onClick={reset}
          style={{ marginTop: 16, padding: '8px 16px', fontSize: 14 }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
