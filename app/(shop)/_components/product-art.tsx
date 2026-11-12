import { brandColor, productImageSlug } from "@/shop/display";
import PHOTOS from "@/shop/product-images.json";

const HAS_PHOTO = new Set<string>(PHOTOS as string[]);
// Fades the photo's square backdrop out at the edges so only the product shows on any background.
const FADE = "radial-gradient(ellipse closest-side at 50% 50%, #000 78%, transparent 100%)";

type Shape = "jar" | "bag" | "box" | "bar" | "can";

function shapeFor(category: string | null, name: string): Shape {
  if (/\bcan\b/i.test(name)) return "can";
  switch (category) {
    case "Trail mix":
    case "Seeds":
      return /jar/i.test(name) ? "jar" : "bag";
    case "Nut mix":
    case "Nuts":
      return "jar";
    case "Popcorn":
      return "box";
    case "Chocolate":
      return "bar";
    default:
      return "bag";
  }
}

function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/)) {
    if ((cur + " " + w).trim().length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

/** Illustrated package for a product: drawn, not photographed, so it is original and always loads. */
export function ProductArt({
  brand,
  label,
  category,
  name,
  className = "",
}: {
  brand: string;
  label: string;
  category: string | null;
  name: string;
  className?: string;
}) {
  // A generated product photo (scripts/generate-product-images.ts) when there is one; the drawing otherwise.
  const slug = productImageSlug(name);
  if (HAS_PHOTO.has(slug)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/products/${slug}.webp`}
        alt={`${brand} ${label}`}
        loading="lazy"
        width={900}
        height={900}
        // multiply blends the photo's cream backdrop into whatever card it sits on
        className={`aspect-square object-contain mix-blend-multiply ${className}`}
        style={{ maskImage: FADE, WebkitMaskImage: FADE }}
      />
    );
  }
  const color = brandColor(brand);
  const shape = shapeFor(category, name);
  const lines = wrap(label, shape === "bar" ? 16 : 11);
  // Brand sits at the top of the label; the name lines always start below it, never on top of it.
  const brandY = shape === "bar" ? 101 : shape === "box" ? 107 : 111;
  const textY = brandY + (shape === "bar" ? 16 : 17);
  const brandText = brand.length > 20 ? brand.slice(0, 19) + "…" : brand;
  const brandMax = shape === "bar" ? 100 : 74; // label inner width
  const brandFits = brandText.length * 6.2 <= brandMax;

  return (
    <svg viewBox="0 0 200 220" className={className} role="img" aria-label={`${brand} ${label}`}>
      <ellipse cx="100" cy="206" rx="62" ry="8" fill="#3a2417" opacity="0.12" />
      {shape === "jar" && (
        <>
          <rect x="58" y="22" width="84" height="26" rx="6" fill="#3a2417" />
          <rect x="44" y="44" width="112" height="156" rx="26" fill={color} />
          <rect x="44" y="44" width="112" height="156" rx="26" fill="url(#shine)" />
        </>
      )}
      {shape === "can" && (
        <>
          <ellipse cx="100" cy="40" rx="56" ry="12" fill="#c9b8a6" />
          <rect x="44" y="40" width="112" height="152" fill={color} />
          <ellipse cx="100" cy="192" rx="56" ry="12" fill={color} />
          <rect x="44" y="40" width="112" height="152" fill="url(#shine)" />
        </>
      )}
      {shape === "bag" && (
        <>
          <path d="M52 30 h96 l8 14 -6 150 q-50 10 -100 0 l-6 -150 z" fill={color} />
          <path d="M52 30 h96 l8 14 h-112 z" fill="#000" opacity="0.15" />
          <path d="M52 30 h96 l8 14 -6 150 q-50 10 -100 0 l-6 -150 z" fill="url(#shine)" />
        </>
      )}
      {shape === "box" && (
        <>
          <path d="M48 46 L152 46 L142 198 L58 198 Z" fill={color} />
          {[0, 1, 2, 3, 4].map((i) => (
            <path key={i} d={`M${58 + i * 20} 46 L${66 + i * 18} 198 L${74 + i * 18} 198 L${68 + i * 20} 46 Z`} fill="#fff" opacity="0.35" />
          ))}
          <circle cx="78" cy="38" r="14" fill="#fff6e8" />
          <circle cx="100" cy="32" r="16" fill="#fff6e8" />
          <circle cx="122" cy="38" r="14" fill="#fff6e8" />
        </>
      )}
      {shape === "bar" && (
        <>
          <rect x="24" y="70" width="152" height="96" rx="10" fill={color} />
          <path d="M24 70 l12 -8 h128 l12 8 z M24 166 l12 8 h128 l12 -8 z" fill="#000" opacity="0.18" />
        </>
      )}
      {/* label */}
      {shape === "bar" ? (
        <rect x="44" y="86" width="112" height="64" rx="8" fill="#fff6e8" />
      ) : (
        <rect x="58" y={shape === "box" ? 92 : 96} width="84" height="72" rx="12" fill="#fff6e8" />
      )}
      <text
        x="100"
        y={brandY}
        textAnchor="middle"
        fontSize="8"
        fontWeight="700"
        fill={color}
        style={{ letterSpacing: "0.06em", textTransform: "uppercase" }}
        {...(brandFits ? {} : { textLength: brandMax, lengthAdjust: "spacingAndGlyphs" })}
      >
        {brandText}
      </text>
      {lines.map((l, i) => (
        <text
          key={i}
          x="100"
          y={textY + i * 14}
          textAnchor="middle"
          fontSize="12"
          fontWeight="800"
          fill="#3a2417"
          fontFamily="var(--font-bricolage), sans-serif"
          {...(l.length * 7 > brandMax ? { textLength: brandMax, lengthAdjust: "spacingAndGlyphs" } : {})}
        >
          {l}
        </text>
      ))}
      <defs>
        <linearGradient id="shine" x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.25" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.8" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.12" />
        </linearGradient>
      </defs>
    </svg>
  );
}
