/**
 * The Wild Frame AI wordmark.
 *
 * Drawn as SVG rather than set in a webfont: it renders identically offline, at
 * any size, with no font-loading flash in front of a customer — and the stacked
 * "WILD / FRAME" lockup with the tilted "AI" is a mark, not a line of text.
 *
 * WILD is hot pink, FRAME is slime green, both with a black outline and a
 * pink/green drop shadow, matching the supplied references.
 */

export type LogoSize = "sm" | "md" | "lg" | "xl";

/**
 * `xl` is proportional rather than fixed: on the attract screen the wordmark is
 * the whole composition, and it should scale with the slab it is shown on
 * instead of leaving a rectangle of black around a 560px graphic.
 */
const SIZES: Record<LogoSize, string> = {
  sm: "w-[170px]",
  md: "w-[280px]",
  lg: "w-[440px]",
  xl: "w-[min(88vw,880px)]",
};

export function WildFrameLogo({
  size = "lg",
  className = "",
  title = "Wild Frame AI",
}: {
  size?: LogoSize;
  className?: string;
  title?: string;
}) {
  const sizeClass = SIZES[size];

  return (
    <svg
      viewBox="0 0 600 268"
      className={`${sizeClass} h-auto max-w-full ${className}`}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="wf-pink-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff5cb0" />
          <stop offset="55%" stopColor="#ff1e8a" />
          <stop offset="100%" stopColor="#d10f6f" />
        </linearGradient>
        <linearGradient id="wf-green-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d4ff5c" />
          <stop offset="55%" stopColor="#b4ff1a" />
          <stop offset="100%" stopColor="#7fc400" />
        </linearGradient>
      </defs>

      <g
        className="wf-display"
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 900,
          fontStyle: "italic",
        }}
      >
        {/* WILD */}
        <text
          x="14"
          y="104"
          fontSize="108"
          letterSpacing="-2"
          fill="url(#wf-pink-grad)"
          stroke="#000000"
          strokeWidth="7"
          paintOrder="stroke fill"
        >
          WILD
        </text>

        {/* FRAME — textLength pins the advance width so the "AI" badge beside it
            never collides, whichever heavy face the device actually resolves. */}
        <text
          x="14"
          y="196"
          fontSize="98"
          letterSpacing="-2"
          textLength="370"
          lengthAdjust="spacingAndGlyphs"
          fill="url(#wf-green-grad)"
          stroke="#000000"
          strokeWidth="7"
          paintOrder="stroke fill"
        >
          FRAME
        </text>

        {/* AI — tilted badge, clear to the lower right of FRAME */}
        <g transform="translate(404 226) rotate(-12)">
          <text
            x="0"
            y="0"
            fontSize="58"
            fill="#ffffff"
            stroke="#000000"
            strokeWidth="5"
            paintOrder="stroke fill"
          >
            AI
          </text>
        </g>
      </g>

      {/* Four-point sparkles, as in the references */}
      <g fill="#ffffff">
        <path d="M470 30 l7 19 19 7 -19 7 -7 19 -7 -19 -19 -7 19 -7z" />
        <path d="M524 74 l4.5 12 12 4.5 -12 4.5 -4.5 12 -4.5 -12 -12 -4.5 12 -4.5z" />
        <path d="M436 6 l3.5 9.5 9.5 3.5 -9.5 3.5 -3.5 9.5 -3.5 -9.5 -9.5 -3.5 9.5 -3.5z" />
      </g>
      <g fill="#b4ff1a">
        <path d="M522 176 l4 11 11 4 -11 4 -4 11 -4 -11 -11 -4 11 -4z" />
      </g>
    </svg>
  );
}
