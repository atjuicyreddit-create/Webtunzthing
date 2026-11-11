// The Pathtoon "Spoken Fork" mark, copied as-is from studio-assets/brand/symbol.svg
// (and symbol-on-dark.svg). Provisional until Tom's final sign-off. Never redraw it;
// to change it, replace these paths with the new file's.
export function Symbol({ onDark = false, size = 32 }: { onDark?: boolean; size?: number }) {
  const body = onDark ? "#FFFFFF" : "#0E1016";
  const dots = onDark ? "#0E1016" : "#F3F0E8";
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width={size} height={size} aria-hidden="true">
      <ellipse cx="70" cy="48" rx="52" ry="36" fill={body} />
      <path d="M 45.59 79.79 L 25.14 111.25 L 24.36 94.87 L 8.72 99.82 L 30.17 71.14 Z" fill={body} />
      <path d="M 24.36 94.87 L 8.72 99.82 L 16.93 105.54 Z" fill="#C8FF3D" />
      <circle cx="54" cy="48.0" r="5.8" fill={dots} />
      <circle cx="70" cy="48.0" r="5.8" fill={dots} />
      <circle cx="86" cy="48.0" r="5.8" fill={dots} />
    </svg>
  );
}
