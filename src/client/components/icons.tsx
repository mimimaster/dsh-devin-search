import type { CSSProperties, HTMLAttributes, SVGProps } from 'react'

export interface IconProps {
  size?: number | string
  className?: string
  style?: CSSProperties
}

/**
 * Piwin Inkstone (砚) signature brand seal.
 * Red cinnabar background (--ink-zhu), white Songti/Serif character '砚',
 * inner delicate hairline outline, and subtle -1.5deg tilt.
 */
export function DevinIcon({
  size = 22,
  className = '',
  style,
  ...props
}: IconProps & HTMLAttributes<HTMLSpanElement>) {
  const pixelSize = typeof size === 'number' ? size : 22
  const fontSize = Math.max(10, Math.round(pixelSize * 0.58))

  return (
    <span
      className={`brand-seal ${className}`.trim()}
      style={{
        width: `${pixelSize}px`,
        height: `${pixelSize}px`,
        fontSize: `${fontSize}px`,
        ...style,
      }}
      aria-hidden="true"
      {...props}
    >
      砚
    </span>
  )
}

/** External arrow — web fetch / browse / auth link. */
export function ExternalLinkIcon({ size = 14, className, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M7 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5V9" />
      <path d="M9.5 2h4.5v4.5" />
      <path d="M14 2L7.5 8.5" />
    </svg>
  )
}

/** Document with folded corner / copy sheet. */
export function CopyIcon({ size = 14, className, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M4 4.5V2.5A1.5 1.5 0 0 1 5.5 1h6.5A1.5 1.5 0 0 1 13.5 2.5V9A1.5 1.5 0 0 1 12 10.5h-1.5" />
      <rect x="2.5" y="4.5" width="8" height="9.5" rx="1.5" />
    </svg>
  )
}

/** Crisp checkmark for completion. */
export function CheckIcon({ size = 14, className, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M3 8.5L6.5 12L13 4" />
    </svg>
  )
}

/** Code brackets glyph. */
export function CodeIcon({ size = 14, className, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M5.5 4.5L2 8l3.5 3.5" />
      <path d="M10.5 4.5L14 8l-3.5 3.5" />
      <path d="M9 3L7 13" />
    </svg>
  )
}

/** Key glyph for credential / auth state. */
export function KeyIcon({ size = 14, className, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <circle cx="5.5" cy="6.5" r="3.5" />
      <path d="M8 9l5.5 5.5" />
      <path d="M11 12l2-0.5" />
      <path d="M12.5 13.5l1.5-1.5" />
    </svg>
  )
}

/** Magnifier — grep / search / explore. */
export function SearchIcon({ size = 14, className, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <circle cx="6.5" cy="6.5" r="4.25" />
      <path d="M9.75 9.75L13.5 13.5" />
    </svg>
  )
}

/** Document with folded corner — read / file. */
export function FileIcon({ size = 14, className, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M4 2h5l3 3v9H4z" />
      <path d="M9 2v3h3" />
    </svg>
  )
}

/** Shield lock for 0600 storage security. */
export function ShieldIcon({ size = 14, className, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M8 1.75L2.5 4.25V7.75C2.5 11.25 4.85 13.75 8 14.5C11.15 13.75 13.5 11.25 13.5 7.75V4.25L8 1.75Z" />
      <path d="M6 7.5L7.5 9L10 6.5" />
    </svg>
  )
}

/** Globe for web search. */
export function GlobeIcon({ size = 14, className, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M2.5 8h11" />
      <path d="M8 2a9.5 9.5 0 0 1 3 6 9.5 9.5 0 0 1-3 6 9.5 9.5 0 0 1-3-6 9.5 9.5 0 0 1 3-6z" />
    </svg>
  )
}

/** Clock / timer for expiration. */
export function ClockIcon({ size = 14, className, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  )
}

export function ChevronRightIcon({ size = 12, className, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M6 3.5L10.5 8L6 12.5" />
    </svg>
  )
}
