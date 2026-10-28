/**
 * fluffdesk 的记号：一把宠物梳，三根齿，强调色线稿。从产品的物件来，不是黑方块里的字母。
 * 只用 currentColor，调用方定颜色。
 */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="16" height="6" rx="3" />
      <path d="M7.5 10v9M12 10v9M16.5 10v9" />
    </svg>
  );
}
