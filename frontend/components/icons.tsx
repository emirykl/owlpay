import type { SVGProps } from 'react';

export function OwlMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" {...props}>
      <rect width="40" height="40" rx="12" fill="currentColor" />
      <path d="M10.5 13.2 16 16a10.7 10.7 0 0 1 8 0l5.5-2.8-1.1 8.5A8.6 8.6 0 0 1 20 29a8.6 8.6 0 0 1-8.4-7.3l-1.1-8.5Z" fill="#FAFAF7" />
      <circle cx="16.2" cy="20.2" r="2.2" fill="currentColor" />
      <circle cx="23.8" cy="20.2" r="2.2" fill="currentColor" />
      <path d="m20 21.5 2 3h-4l2-3Z" fill="#D8A72D" />
    </svg>
  );
}

export function ArrowUpRight(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}><path d="M5 15 15 5m0 0H7m8 0v8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function Check(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}><path d="m5 10.3 3.2 3.2L15 6.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

