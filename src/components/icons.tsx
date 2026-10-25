import type { SVGProps } from 'react'

// The post action icons from the original Epub Feed, drawn as strokes so `.on` can fill them.
const Stroke = ({ d, ...props }: { d: string } & SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d={d} />
  </svg>
)

export const HeartIcon = (p: SVGProps<SVGSVGElement>) => (
  <Stroke
    d="M12 20.5s-7.5-4.7-9.4-9.4C1.3 7.8 3.2 4.5 6.5 4.5c2 0 3.7 1.1 5.5 3.2 1.8-2.1 3.5-3.2 5.5-3.2 3.3 0 5.2 3.3 3.9 6.6-1.9 4.7-9.4 9.4-9.4 9.4z"
    {...p}
  />
)
export const ViewsIcon = (p: SVGProps<SVGSVGElement>) => <Stroke d="M5 20V11M12 20V4M19 20v-6" {...p} />
export const BookmarkIcon = (p: SVGProps<SVGSVGElement>) => <Stroke d="M6 3.5h12v17l-6-4.5-6 4.5z" {...p} />
export const ShareIcon = (p: SVGProps<SVGSVGElement>) => (
  <Stroke d="M12 15V3.5m0 0L7.5 8M12 3.5L16.5 8M5 12v6.5a2 2 0 002 2h10a2 2 0 002-2V12" {...p} />
)

export const VerifiedIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 22 22" aria-label="Verified" {...p}>
    <path
      fill="currentColor"
      d="M20.4 11l-1.8-2 .3-2.7-2.6-.6-1.4-2.3-2.5 1-2.5-1-1.4 2.3-2.6.6.3 2.7-1.8 2 1.8 2-.3 2.7 2.6.6 1.4 2.3 2.5-1 2.5 1 1.4-2.3 2.6-.6-.3-2.7z"
    />
    <path
      fill="none"
      stroke="#fff"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M7.5 11.2l2.4 2.4 4.6-4.8"
    />
  </svg>
)

export const PinIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" {...p}>
    <path d="M14.5 2.5l7 7-2 .8-3.3 3.3.4 4.4-1.6 1.6-4-4-5.4 5.4-1.4-1.4 5.4-5.4-4-4 1.6-1.6 4.4.4 3.3-3.3z" />
  </svg>
)
