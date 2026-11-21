import React from 'react';

export function Skeleton({
  className = '',
  count = 1,
}: {
  className?: string;
  count?: number;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading content"
      className="space-y-2.5 w-full"
    >
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className={`h-5 bg-border/40 rounded animate-pulse ${className}`}
        />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
