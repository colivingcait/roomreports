export function SkeletonLine({ width = '100%', height = '1rem' }) {
  return <div className="skeleton" style={{ width, height, borderRadius: 6 }} />;
}

export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <SkeletonLine width="60%" height="1rem" />
      <SkeletonLine width="40%" height="0.75rem" />
      <SkeletonLine width="80%" height="0.75rem" />
    </div>
  );
}

export function SkeletonList({ count = 3 }) {
  return (
    <div className="skeleton-list">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
