const BRAND_BLUE = "#3B8BF5";

export default function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="cw-top">
          <rect width="512" height="244" />
        </clipPath>
        <clipPath id="cw-bot">
          <rect y="268" width="512" height="244" />
        </clipPath>
      </defs>

      {/* Top arc */}
      <circle cx="256" cy="256" r="216" stroke={BRAND_BLUE} strokeWidth="22" clipPath="url(#cw-top)" />

      {/* Bottom arc */}
      <circle cx="256" cy="256" r="216" stroke={BRAND_BLUE} strokeWidth="22" clipPath="url(#cw-bot)" />

      {/* Dotted split line */}
      <circle cx="62"  cy="256" r="9" fill={BRAND_BLUE} />
      <circle cx="118" cy="256" r="9" fill={BRAND_BLUE} />
      <circle cx="174" cy="256" r="9" fill={BRAND_BLUE} />
      <circle cx="230" cy="256" r="9" fill={BRAND_BLUE} />
      <circle cx="282" cy="256" r="9" fill={BRAND_BLUE} />
      <circle cx="338" cy="256" r="9" fill={BRAND_BLUE} />
      <circle cx="394" cy="256" r="9" fill={BRAND_BLUE} />
      <circle cx="450" cy="256" r="9" fill={BRAND_BLUE} />

      {/* 12 o'clock tick */}
      <line x1="256" y1="48" x2="256" y2="80" stroke={BRAND_BLUE} strokeWidth="14" strokeLinecap="round" />

      {/* Hour hand - 10 o'clock */}
      <line x1="256" y1="256" x2="162" y2="192" stroke={BRAND_BLUE} strokeWidth="24" strokeLinecap="round" />

      {/* Minute hand - 2 o'clock */}
      <line x1="256" y1="256" x2="390" y2="176" stroke={BRAND_BLUE} strokeWidth="16" strokeLinecap="round" />

      {/* Center pivot */}
      <circle cx="256" cy="256" r="22" fill={BRAND_BLUE} />
    </svg>
  );
}
