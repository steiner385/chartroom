/**
 * Loading-placeholder block (#188). A solid muted box (so it always reserves its
 * height, even with reduced motion) with a shimmer animation gated on
 * prefers-reduced-motion via the `.skeleton` CSS. Decorative — aria-hidden; the
 * surrounding region carries the role="status"/aria-busy.
 */
export function Skeleton({ height = '1em', width = '100%', radius = 4, className = '' }: {
  height?: string | number;
  width?: string | number;
  radius?: number | string;
  className?: string;
}) {
  return (
    <div
      className={`skeleton ${className}`.trim()}
      aria-hidden="true"
      style={{ height, width, borderRadius: radius }}
    />
  );
}
