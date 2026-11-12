import "dotenv/config";
import { getDb, closeDb, schema } from "./client";
import type { DB } from "./client";
import { eq } from "drizzle-orm";
import { SHOPPER } from "../shop/shopper";

/**
 * Seeds one fictional demo store. Everything here is simulated and labeled as such.
 * The hero product, Fisher Tex Mex Trail Mix 30 oz, is shaped around the real openFDA recall
 * H-0836-2026 (see fixtures/recalls/01-hero-match.json).
 *
 * Hero orders: 211 total. 14 in the recalled batch (best by 2027-08-06), 5 in the batch that the
 * simulated expansion adds (best by 2027-09-17), the rest in safe batches.
 *
 * Run `npm run seed:paypal` afterwards to attach real sandbox payments to the hero orders that matter.
 */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** UPC-A with a valid check digit, prefix 2 (in-store / restricted range) so it cannot be a real product. */
function fakeUpc(n: number): string {
  const body = `2${String(n).padStart(10, "0")}`;
  let sum = 0;
  body.split("").forEach((d, i) => (sum += Number(d) * (i % 2 === 0 ? 3 : 1)));
  return body + ((10 - (sum % 10)) % 10);
}

type ProductSeed = {
  sku: string;
  name: string;
  brand: string;
  upc: string | null;
  size: string;
  category: string;
  priceCents: number;
  batches: { lot: string; bestBy: string; received: string }[];
  weight: number; // relative popularity for non-hero orders
  /** Index of the batch on the shelf now (storefront orders are filled from it). Default: the latest. */
  shelf?: number;
};

const HERO_SKU = "TP-FIS-TEXMEX-30";

const PRODUCTS: ProductSeed[] = [
  {
    sku: HERO_SKU,
    name: "Fisher Tex Mex Trail Mix 30 oz Jar",
    brand: "Fisher",
    upc: "070690275941",
    size: "30 oz",
    category: "Trail mix",
    priceCents: 1799,
    batches: [
      { lot: "FTM-2507A", bestBy: "2027-07-02", received: "2026-08-05" },
      { lot: "FTM-2508B", bestBy: "2027-08-06", received: "2026-09-08" },
      { lot: "FTM-2509C", bestBy: "2027-09-17", received: "2026-10-04" },
      { lot: "FTM-2510D", bestBy: "2027-10-22", received: "2026-10-14" },
    ],
    weight: 0,
    // The storefront sells from the batch that the real recall H-0836-2026 covers (best by 08/06/27),
    // so a purchase made live in the demo is caught by the recall check.
    shelf: 1,
  },
  {
    sku: "TP-SSN-HUNTER-23",
    name: "Southern Style Nuts Gourmet Hunter Mix 23 oz",
    brand: "Southern Style Nuts",
    upc: "085839073319",
    size: "23 oz",
    category: "Nut mix",
    priceCents: 1449,
    batches: [
      { lot: "SSN-0421", bestBy: "2027-04-20", received: "2026-08-20" },
      { lot: "SSN-0515", bestBy: "2027-05-15", received: "2026-10-01" },
    ],
    weight: 5,
  },
  {
    sku: "TP-SQB-CLASSIC-16",
    name: "Squirrel Brand Classic Mixed Nuts 16 oz Can",
    brand: "Squirrel Brand",
    upc: null,
    size: "16 oz",
    category: "Nut mix",
    priceCents: 1299,
    batches: [{ lot: "SQB-1188", bestBy: "2027-06-30", received: "2026-08-15" }],
    weight: 4,
  },
  {
    sku: "TP-PRO-FUDGE-35",
    name: "Prospector Popcorn Fudge Brownie Gourmet Popcorn 3.5 oz",
    brand: "Prospector Popcorn",
    upc: "850073852293",
    size: "3.5 oz",
    category: "Popcorn",
    priceCents: 699,
    batches: [
      { lot: "PP-0530", bestBy: "2027-05-30", received: "2026-08-12" },
      { lot: "PP-0815", bestBy: "2027-08-15", received: "2026-10-10" },
    ],
    weight: 4,
  },
];

const HOUSE = [
  ["Ridgeway Snacks", "Honey Roasted Cashews", "12 oz", "Nuts", 1099],
  ["Ridgeway Snacks", "Sea Salt Almonds", "16 oz", "Nuts", 1199],
  ["Ridgeway Snacks", "Smoky Pecan Halves", "8 oz", "Nuts", 999],
  ["Meadowlark Farms", "Organic Trail Mix", "340 g", "Trail mix", 1149],
  ["Meadowlark Farms", "Dried Mango Slices", "6 oz", "Dried fruit", 849],
  ["Meadowlark Farms", "Tart Cherry Medley", "8 oz", "Dried fruit", 899],
  ["Meadowlark Farms", "Maple Pecan Granola", "12 oz", "Granola", 749],
  ["Meadowlark Farms", "Vanilla Almond Granola", "12 oz", "Granola", 749],
  ["Copper Kettle Co.", "Kettle Corn", "7 oz", "Popcorn", 599],
  ["Copper Kettle Co.", "White Cheddar Popcorn", "5 oz", "Popcorn", 599],
  ["Copper Kettle Co.", "Caramel Pretzel Bites", "10 oz", "Snacks", 699],
  ["Copper Kettle Co.", "Sourdough Pretzel Twists", "16 oz", "Snacks", 549],
  ["High Desert Provisions", "Peppered Beef Jerky", "3 oz", "Jerky", 999],
  ["High Desert Provisions", "Teriyaki Beef Jerky", "3 oz", "Jerky", 999],
  ["High Desert Provisions", "Spicy Turkey Sticks", "6 oz", "Jerky", 899],
  ["High Desert Provisions", "Chile Lime Pistachios", "8 oz", "Nuts", 1049],
  ["Harbor Lane", "Dark Chocolate Sea Salt Bar", "3 oz", "Chocolate", 449],
  ["Harbor Lane", "Milk Chocolate Almond Clusters", "8 oz", "Chocolate", 899],
  ["Harbor Lane", "Espresso Bean Bark", "6 oz", "Chocolate", 799],
  ["Harbor Lane", "Peanut Butter Cups", "7 oz", "Chocolate", 699],
  ["Trailhead Pantry", "Campfire Trail Mix", "1 lb", "Trail mix", 1099],
  ["Trailhead Pantry", "Tropical Fruit and Nut Mix", "14 oz", "Trail mix", 999],
  ["Trailhead Pantry", "Spiced Pumpkin Seeds", "10 oz", "Seeds", 649],
  ["Trailhead Pantry", "Roasted Sunflower Kernels", "12 oz", "Seeds", 499],
  ["Trailhead Pantry", "Banana Chips", "8 oz", "Dried fruit", 449],
  ["Trailhead Pantry", "Rice Cracker Mix", "9 oz", "Snacks", 549],
] as const;

const FIRST = ["Ava", "Liam", "Mia", "Noah", "Zoe", "Ethan", "Leah", "Owen", "Isla", "Lucas", "Nora", "Eli", "Ruby", "Jonah", "Iris", "Theo", "Maya", "Caleb", "Lena", "Felix", "Ana", "Ravi", "Priya", "Sam", "Jules", "Kai", "Rosa", "Omar", "Hana", "Dev"];
const LAST = ["Alvarez", "Brooks", "Chen", "Dalton", "Ellis", "Foster", "Garcia", "Hughes", "Iyer", "Jensen", "Khan", "Lopez", "Moreno", "Nakamura", "Okafor", "Patel", "Quinn", "Reyes", "Silva", "Tran"];

async function wipe(db: DB) {
  // Reverse FK order. Demo only.
  for (const t of [
    schema.notices, schema.actions, schema.affectedItems, schema.incidents, schema.matches, schema.recallParsed,
    schema.recalls, schema.disputes, schema.orderItems, schema.orders, schema.batches, schema.customers,
    schema.products, schema.auditEvents, schema.stores,
  ]) await db.delete(t);
}

export async function seed(opts: { anchor?: Date } = {}) {
  const db = await getDb();
  const rand = rng(20261111);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const anchor = opts.anchor ?? new Date();
  const dayMs = 86_400_000;
  const daysAgo = (d: number) => new Date(anchor.getTime() - d * dayMs - Math.floor(rand() * 10 * 3_600_000));

  await wipe(db);

  const [store] = await db
    .insert(schema.stores)
    .values({ name: "Trailhead Pantry (demo store)", ownerEmail: "owner@trailhead-pantry.example", isDemo: true })
    .returning();

  const productSeeds: ProductSeed[] = [
    ...PRODUCTS,
    ...HOUSE.map(([brand, name, size, category, price], i): ProductSeed => {
      // A few products have no barcode on purpose.
      const upc = i % 9 === 4 ? null : fakeUpc(100 + i);
      const sku = `TP-${brand.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(3, "0")}`;
      const b1 = new Date(Date.UTC(2027, 1 + (i % 6), 10 + (i % 15))).toISOString().slice(0, 10);
      const b2 = new Date(Date.UTC(2027, 5 + (i % 6), 5 + (i % 20))).toISOString().slice(0, 10);
      return {
        sku,
        name: `${brand} ${name} ${size}`,
        brand,
        upc,
        size,
        category,
        priceCents: price,
        batches: [
          { lot: `${sku.slice(3, 6)}${i}A`, bestBy: b1, received: "2026-08-01" },
          ...(i % 3 === 0 ? [] : [{ lot: `${sku.slice(3, 6)}${i}B`, bestBy: b2, received: "2026-10-01" }]),
        ],
        weight: 1 + (i % 4),
      };
    }),
  ];

  const productRows: { seed: ProductSeed; id: string; batchIds: string[] }[] = [];
  for (const p of productSeeds) {
    const [row] = await db
      .insert(schema.products)
      .values({ storeId: store.id, sku: p.sku, name: p.name, brand: p.brand, upc: p.upc, sizeText: p.size, category: p.category, priceCents: p.priceCents })
      .returning({ id: schema.products.id });
    const batchRows = await db
      .insert(schema.batches)
      .values(p.batches.map((b) => ({ productId: row.id, lotCode: b.lot, bestBy: b.bestBy, receivedAt: b.received })))
      .returning({ id: schema.batches.id });
    const shelf = batchRows[p.shelf ?? batchRows.length - 1];
    await db.update(schema.products).set({ shelfBatchId: shelf.id }).where(eq(schema.products.id, row.id));
    productRows.push({ seed: p, id: row.id, batchIds: batchRows.map((b) => b.id) });
  }

  const customerValues = Array.from({ length: 120 }, (_, i) => {
    const f = FIRST[i % FIRST.length];
    const l = LAST[Math.floor(i / FIRST.length) % LAST.length];
    const name = `${f} ${l}${i >= FIRST.length * LAST.length ? ` ${i}` : ""}`;
    return { storeId: store.id, name, email: `${f}.${l}.${i}@example.com`.toLowerCase(), isDemo: true };
  });
  const customers = await db.insert(schema.customers).values(customerValues).returning({ id: schema.customers.id });
  // The shopper the demo presenter plays on the storefront. Has no seeded orders.
  await db.insert(schema.customers).values({ storeId: store.id, name: SHOPPER.name, email: SHOPPER.email, isDemo: true });

  const hero = productRows[0];
  const others = productRows.slice(1);
  const otherWeights = others.flatMap((p) => Array(p.seed.weight).fill(p));

  type Line = { productId: string; batchId: string | null; qty: number; price: number };
  type OrderSeed = { at: Date; lines: Line[]; paymentMethod: "card" | "buyer" | null };
  const orderSeeds: OrderSeed[] = [];

  const otherLine = (): Line => {
    const p = pick(otherWeights) as (typeof productRows)[number];
    // Some items have no batch recorded, which sends them to review if a recall ever matches.
    const batchId = rand() < 0.05 ? null : pick(p.batchIds);
    return { productId: p.id, batchId, qty: rand() < 0.2 ? 2 : 1, price: p.seed.priceCents };
  };

  // Hero orders: [batch index, count, day window]
  const heroPlan: [number, number, number, number][] = [
    [0, 120, 90, 45],
    [1, 14, 60, 38],
    [2, 5, 37, 25],
    [3, 72, 28, 1],
  ];
  // Which hero orders get real sandbox payments: all of batch B and C, plus 5 unaffected ones.
  // All are paid by card (npm run seed:paypal). The dispute-capable PayPal-wallet order is the one the
  // presenter places live on the storefront.
  let unaffectedReal = 0;
  for (const [bi, count, from, to] of heroPlan) {
    const dated = Array.from({ length: count }, () => daysAgo(to + Math.floor(rand() * (from - to)))).sort((a, b) => a.getTime() - b.getTime());
    dated.forEach((at, k) => {
      const qty = bi === 1 ? (k % 3 === 0 ? 2 : 1) : rand() < 0.15 ? 2 : 1;
      const lines: Line[] = [{ productId: hero.id, batchId: hero.batchIds[bi], qty, price: hero.seed.priceCents }];
      if (rand() < 0.3) lines.push(otherLine());
      let paymentMethod: OrderSeed["paymentMethod"] = null;
      if (bi === 1 || bi === 2) paymentMethod = "card";
      else if ((bi === 0 || bi === 3) && unaffectedReal < 5 && k % 17 === 3) {
        paymentMethod = "card";
        unaffectedReal++;
      }
      orderSeeds.push({ at, lines, paymentMethod });
    });
  }

  // Other orders.
  for (let i = 0; i < 300; i++) {
    const lines = [otherLine()];
    if (rand() < 0.35) lines.push(otherLine());
    orderSeeds.push({ at: daysAgo(1 + Math.floor(rand() * 89)), lines, paymentMethod: null });
  }

  orderSeeds.sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const o of orderSeeds) {
    const total = o.lines.reduce((s, l) => s + l.qty * l.price, 0);
    const [orderRow] = await db
      .insert(schema.orders)
      .values({
        storeId: store.id,
        customerId: pick(customers).id,
        orderedAt: o.at,
        totalCents: total,
        currency: "USD",
        isRealSandbox: false,
        paymentMethod: o.paymentMethod,
      })
      .returning({ id: schema.orders.id });
    await db.insert(schema.orderItems).values(
      o.lines.map((l) => ({ orderId: orderRow.id, productId: l.productId, batchId: l.batchId, quantity: l.qty, unitPriceCents: l.price })),
    );
  }

  await db.insert(schema.auditEvents).values({
    actor: "system",
    eventType: "demo_seeded",
    storeId: store.id,
    payload: { products: productSeeds.length, customers: customers.length, orders: orderSeeds.length, heroOrders: 211 },
  });

  return { storeId: store.id, products: productSeeds.length, customers: customers.length, orders: orderSeeds.length };
}

if (process.argv[1] && /seed\.ts$/.test(process.argv[1])) {
  const r = await seed();
  console.log(`Seeded demo store: ${r.products} products, ${r.customers} customers, ${r.orders} orders.`);
  console.log("Next: npm run seed:paypal (needs PayPal sandbox credentials) to attach real sandbox payments.");
  await closeDb();
}

/** The product catalog without touching the database (used by scripts/generate-product-images.ts). */
export function catalog(): { name: string; brand: string; size: string; category: string; realBrand: boolean }[] {
  return [
    ...PRODUCTS.map((p) => ({ name: p.name, brand: p.brand, size: p.size, category: p.category, realBrand: true })),
    ...HOUSE.map(([brand, name, size, category]) => ({ name: `${brand} ${name} ${size}`, brand, size, category, realBrand: false })),
  ];
}
