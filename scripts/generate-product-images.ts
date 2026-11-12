/**
 * Generates a realistic product photo for every catalog product with Gemini image generation and
 * writes public/products/<slug>.webp plus src/shop/product-images.json (the list the storefront uses).
 *
 *   npx tsx scripts/generate-product-images.ts          # only missing images
 *   npx tsx scripts/generate-product-images.ts --force  # regenerate all
 *   npx tsx scripts/generate-product-images.ts --only=fisher   # names containing "fisher"
 *
 * Real third-party brands get plain, unbranded packaging: we never recreate a real brand's design.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { GoogleGenAI } from "@google/genai";
import { catalog } from "../src/db/seed";
import { productImageSlug } from "../src/shop/display";

const MODEL = process.env.IMAGE_MODEL || "gemini-3.1-flash-image";
const OUT = path.join(process.cwd(), "public", "products");
const MANIFEST = path.join(process.cwd(), "src", "shop", "product-images.json");
const force = process.argv.includes("--force");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).toLowerCase();

const PACKAGE: Record<string, string> = {
  "Trail mix": "a clear plastic snack jar with a screw lid, filled with trail mix so the contents are visible",
  "Nut mix": "a clear plastic jar with a screw lid, filled with mixed nuts",
  Nuts: "a stand-up resealable kraft paper pouch with a small clear window showing the nuts",
  Popcorn: "a stand-up snack bag of gourmet popcorn, with a few pieces of popcorn in front of it",
  Chocolate: "chocolate packaging",
  Jerky: "a stand-up resealable matte pouch with a clear window showing the jerky",
  "Dried fruit": "a stand-up resealable pouch with a clear window showing the dried fruit",
  Granola: "a stand-up kraft paper bag of granola, with a small pile of granola in front of it",
  Seeds: "a stand-up resealable pouch with a clear window showing the seeds",
  Snacks: "a stand-up snack bag, with a few pieces of the snack in front of it",
};

function packageFor(p: { name: string; category: string }): string {
  const n = p.name.toLowerCase();
  if (/\bcan\b/.test(n)) return "a round metal snack can with a peel-off lid, a few nuts beside it";
  if (/bar$|bar\s/.test(n) && p.category === "Chocolate") return "a flat wrapped chocolate bar, with one broken square of dark chocolate beside it";
  if (p.category === "Chocolate") return "a stand-up resealable pouch with a clear window showing the chocolates, a few pieces in front of it";
  return PACKAGE[p.category] ?? "a stand-up snack bag";
}

function prompt(p: ReturnType<typeof catalog>[number]): string {
  const product = p.realBrand ? p.name.replace(p.brand, "").replace(/\s+(Jar|Can)$/i, "").trim() : p.name.replace(p.brand, "").replace(p.size, "").trim();
  const label = p.realBrand
    ? `The packaging is plain and unbranded: a simple cream paper label with only the words "${product.replace(p.size, "").trim()}" and "${p.size}" in a clean sans-serif font. No logos, no brand names, no other text.`
    : `The label shows the brand "${p.brand}" and the product name "${product}" and "${p.size}", in a tasteful modern small-batch food design. All text must be spelled exactly like that; no other words.`;
  return [
    `Professional e-commerce product photograph of ${packageFor(p)}. The product is ${product}.`,
    label,
    "One single product, centered, front view, filling about 70 percent of the frame.",
    "Seamless warm cream background (#fff6e8), soft diffused studio lighting from the upper left, a soft natural shadow under the product.",
    "Photorealistic, sharp focus, high detail, no props other than a few pieces of the food itself, no hands, no watermark.",
  ].join(" ");
}

async function main() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  fs.mkdirSync(OUT, { recursive: true });
  const items = catalog().filter((p) => !only || p.name.toLowerCase().includes(only));
  let i = 0;
  const failures: string[] = [];

  async function worker() {
    while (i < items.length) {
      const p = items[i++];
      const slug = productImageSlug(p.name);
      const file = path.join(OUT, `${slug}.webp`);
      if (!force && fs.existsSync(file)) {
        console.log(`skip   ${slug}`);
        continue;
      }
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await ai.models.generateContent({
            model: MODEL,
            contents: prompt(p),
            config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } },
          });
          const part = res.candidates?.[0]?.content?.parts?.find((x) => x.inlineData?.data);
          if (!part?.inlineData?.data) throw new Error(`no image returned (${res.candidates?.[0]?.finishReason ?? "unknown"})`);
          await sharp(Buffer.from(part.inlineData.data, "base64")).resize(900, 900, { fit: "cover" }).webp({ quality: 82 }).toFile(file);
          console.log(`ok     ${slug}`);
          break;
        } catch (e) {
          console.log(`retry  ${slug} (${attempt}): ${(e as Error).message.slice(0, 160)}`);
          if (attempt === 3) failures.push(slug);
          else await new Promise((r) => setTimeout(r, 3000 * attempt));
        }
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);

  const have = catalog()
    .map((p) => productImageSlug(p.name))
    .filter((s) => fs.existsSync(path.join(OUT, `${s}.webp`)));
  fs.writeFileSync(MANIFEST, JSON.stringify(have, null, 2) + "\n");
  console.log(`\n${have.length} product photos in public/products. ${failures.length ? `Failed: ${failures.join(", ")}` : "No failures."}`);
}

await main();
