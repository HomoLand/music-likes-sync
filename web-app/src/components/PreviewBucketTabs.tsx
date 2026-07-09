import type { PreviewBucketSummary } from '../api/types';

interface PreviewBucketTabsProps {
  buckets: PreviewBucketSummary[];
  activeBucket: PreviewBucketSummary['id'];
  onChange: (bucket: PreviewBucketSummary['id']) => void;
}

export function PreviewBucketTabs({ buckets, activeBucket, onChange }: PreviewBucketTabsProps) {
  if (!buckets.length) return null;
  return (
    <div className="bucket-tabs" data-testid="react-preview-buckets" role="tablist" aria-label="同步预览分类">
      {buckets.map((bucket) => (
        <button
          aria-selected={activeBucket === bucket.id}
          className={activeBucket === bucket.id ? 'active' : ''}
          data-testid={`react-preview-bucket-${bucket.id}`}
          key={bucket.id}
          onClick={() => onChange(bucket.id)}
          role="tab"
          type="button"
        >
          <span>{bucket.label}</span>
          <strong>{bucket.count}</strong>
        </button>
      ))}
    </div>
  );
}
