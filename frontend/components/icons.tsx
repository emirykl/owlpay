import type { SVGProps } from 'react';

export function OwlMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" {...props}>
      <rect x=".5" y=".5" width="39" height="39" rx="11.5" fill="white" stroke="rgba(18,19,15,.1)" />
      <svg x="3.5" y="2" width="33" height="36" viewBox="300 140 650 960" preserveAspectRatio="xMidYMid meet">
        <image href="/owlpay-logo.png" width="1254" height="1254" />
      </svg>
    </svg>
  );
}

export function ArrowUpRight(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}><path d="M5 15 15 5m0 0H7m8 0v8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function Check(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}><path d="m5 10.3 3.2 3.2L15 6.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function Users(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}><path d="M7.5 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm5.75-1a2.25 2.25 0 1 0 0-4.5M2.5 16.5v-1.25A3.75 3.75 0 0 1 6.25 11.5h2.5a3.75 3.75 0 0 1 3.75 3.75v1.25m.25-5a3.5 3.5 0 0 1 3.5 3.5v1" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function Calendar(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}><rect x="2.75" y="4.25" width="14.5" height="13" rx="2.25" stroke="currentColor" strokeWidth="1.45" /><path d="M6.25 2.5v3.25m7.5-3.25v3.25M2.75 8h14.5" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" /></svg>;
}

export function GitHubMark(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}><path d="M12 2.2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.87c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.64-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.5 9.5 0 0 1 12 7.03c.85 0 1.69.11 2.48.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.77c0 .27.18.58.69.48A10 10 0 0 0 12 2.2Z" /></svg>;
}

export function MetaMaskMark(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}><path d="m20.2 3.5-6.9 5.1 1.28-3.03L20.2 3.5Z" fill="#E17726" /><path d="m3.8 3.5 6.84 5.15-1.22-3.08L3.8 3.5Z" fill="#E27625" /><path d="m17.72 15.38-1.84 2.82 3.94 1.08 1.13-3.83-3.23-.07ZM3.06 15.45l1.12 3.83 3.94-1.08-1.84-2.82-3.22.07Z" fill="#E27625" /><path d="m7.9 10.62-1.1 1.67 3.9.18-.13-4.2-2.67 2.35Zm8.2 0-2.7-2.4-.09 4.25 3.89-.18-1.1-1.67Z" fill="#E27625" /><path d="m8.12 18.2 2.35-1.14-2.03-1.58-.32 2.72Zm5.41-1.14 2.35 1.14-.32-2.72-2.03 1.58Z" fill="#E27625" /><path d="m15.88 18.2-2.35-1.14.19 1.53-.02.64 2.18-1.03Zm-7.76 0 2.18 1.03-.01-.64.18-1.53-2.35 1.14Z" fill="#D5BFB2" /><path d="m10.34 14.47-1.96-.58 1.38-.63.58 1.21Zm3.32 0 .58-1.21 1.39.63-1.97.58Z" fill="#233447" /><path d="m8.12 18.2.34-2.82-2.18.06 1.84 2.76Zm7.42-2.82.34 2.82 1.84-2.76-2.18-.06Zm1.66-3.09-3.89.18.36 2  .58-1.21 1.39.63 1.56-1.6Zm-8.82 1.6 1.38-.63.58 1.21.36-2-3.9-.18 1.58 1.6Z" fill="#CC6228" /><path d="m6.8 12.29 1.64 3.19-.06-1.59-1.58-1.6Zm8.84 1.6-.08 1.59 1.64-3.19-1.56 1.6Zm-4.94-1.42-.36 2 .46 2.38.1-3.14-.2-1.24Zm2.61 0-.2 1.23.09 3.15.47-2.38-.36-2Z" fill="#E27525" /><path d="m13.67 14.47-.47 2.38.33.21 2.03-1.58.08-1.59-1.97.58Zm-5.29-.58.06 1.59 2.03 1.58.33-.21-.46-2.38-1.96-.58Z" fill="#F5841F" /><path d="m13.7 19.23.02-.64-.17-.15h-3.1l-.16.15.01.64-2.18-1.03.76.62 1.54 1.06h3.16l1.54-1.06.76-.62-2.18 1.03Z" fill="#C0AC9D" /><path d="m13.53 17.06-.33-.21h-2.4l-.33.21-.18 1.53.16-.15h3.1l.17.15-.19-1.53Z" fill="#161616" /><path d="m20.5 8.93.59-2.84-.89-2.59-6.67 4.94 2.57 2.18 3.63 1.06.8-.94-.35-.25.55-.5-.42-.33.55-.42-.36-.31ZM2.91 6.09l.59 2.84-.37.31.56.42-.42.33.55.5-.35.25.8.94 3.63-1.06 2.57-2.18L3.8 3.5l-.89 2.59Z" fill="#763E1A" /></svg>;
}

export function LinkMark(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}><path d="M7.75 12.25 12.25 7.75M6.1 14.62l-1.02 1.02a3.35 3.35 0 0 1-4.72-4.75l2.48-2.47a3.34 3.34 0 0 1 4.72 0m4.88 3.16a3.34 3.34 0 0 1 4.72 0l2.48-2.47a3.35 3.35 0 0 0-4.72-4.75L13.9 5.38" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}
