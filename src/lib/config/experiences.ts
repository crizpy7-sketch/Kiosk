import { z } from "zod";

/**
 * Transformation experiences.
 *
 * These are the *only* prompts that ever reach the AI provider. There is no
 * free-text field anywhere in the kiosk — the customer picks a card, and the
 * server looks up the prompt by slug. That is what keeps a supervised,
 * family-friendly kiosk family-friendly.
 *
 * Rows in the `experiences` table override `active`, `featured`, `price_cents`
 * and `sort_order` at runtime (the owner can toggle a style off or change the
 * price without a deploy). Everything else — prompts, model preference, audience
 * — is code, reviewed in a pull request, never editable from a web form.
 */

export const AUDIENCE_CATEGORIES = ["all_ages"] as const;
export type AudienceCategory = (typeof AUDIENCE_CATEGORIES)[number];

/** Realtime model ids currently offered by Decart (@decartai/sdk 0.1.x). */
export const REALTIME_MODELS = [
  "lucy-2.1",
  "lucy-2.5",
  "lucy-restyle-2",
  "lucy-restyle-latest",
  "lucy-latest",
] as const;
export type RealtimeModel = (typeof REALTIME_MODELS)[number];

export const experienceSchema = z.object({
  id: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.object({ en: z.string().min(1), es: z.string().min(1) }),
  tagline: z.object({ en: z.string().min(1), es: z.string().min(1) }),
  /**
   * Path under /public. A still or a short muted loop — never a live camera.
   * These ship as the four portraits from the brand poster; replace them with
   * real Lucy output once the pilot has produced a shot the subject consented
   * to (scripts/extract-previews.ts regenerates them from a poster).
   */
  previewAsset: z.string().min(1),
  /** Optional style reference handed to the model via setImage(). */
  referenceAsset: z.string().nullable(),
  prompt: z.string().min(10),
  /** Appended to the prompt; keeps output on-brand and on-policy. */
  negativeConstraints: z.array(z.string().min(1)).min(1),
  modelPreference: z.enum(REALTIME_MODELS),
  active: z.boolean(),
  featured: z.boolean(),
  priceCents: z.number().int().min(100).max(9999),
  maxGenerationSeconds: z.number().int().min(5).max(120),
  audience: z.enum(AUDIENCE_CATEGORIES),
  sortOrder: z.number().int(),
  /** Card accent — drives the gradient and glow in the style picker. */
  theme: z.enum(["slime", "anime", "royal", "baby"]),
});

export type Experience = z.infer<typeof experienceSchema>;

/**
 * Shared safety rail appended to every prompt. Duplicated intentionally into
 * each experience's negativeConstraints so a single experience can never be
 * edited into something unsafe without the reviewer seeing it.
 */
const UNIVERSAL_CONSTRAINTS = [
  "no nudity",
  "no revealing or sexualized clothing",
  "no gore or blood",
  "no weapons",
  "no text or watermarks",
  "no real-world celebrity likeness",
  "no branded or trademarked characters",
];

const DEFAULT_PRICE_CENTS = 599;

export const EXPERIENCES: readonly Experience[] = [
  {
    id: "exp_slime_star",
    slug: "slime-star",
    name: { en: "Slime Star", es: "Estrella Slime" },
    tagline: { en: "Go wild.", es: "Sin límites." },
    previewAsset: "/previews/slime-star.jpg",
    referenceAsset: null,
    prompt:
      "High-energy editorial pop-star portrait. Glossy hot-pink hair and neon slime-green highlights, " +
      "dripping glossy black and lime slime textures swirling around the shoulders, oversized star-shaped " +
      "sunglasses, wet-look glitter skin sheen, saturated magenta and acid-green studio lighting with rim light, " +
      "playful confident expression, fashion magazine cover energy, sharp focus on the face.",
    negativeConstraints: [...UNIVERSAL_CONSTRAINTS, "no distorted facial features", "no extra limbs"],
    modelPreference: "lucy-restyle-2",
    active: true,
    featured: false,
    priceCents: DEFAULT_PRICE_CENTS,
    maxGenerationSeconds: 15,
    audience: "all_ages",
    sortOrder: 10,
    theme: "slime",
  },
  {
    id: "exp_anime_power_up",
    slug: "anime-power-up",
    name: { en: "Anime Power-Up", es: "Poder Anime" },
    tagline: { en: "Level up.", es: "Sube de nivel." },
    previewAsset: "/previews/anime-power-up.jpg",
    referenceAsset: null,
    prompt:
      "Heroic anime-inspired hero portrait. Crackling electric-blue energy aura and lightning arcs behind the " +
      "subject, dramatic cinematic key light with deep blue and cyan rim lighting, windswept stylized hair, " +
      "determined confident expression, glowing particles rising, dynamic action-scene composition, " +
      "clean modern anime illustration styling, family-friendly.",
    negativeConstraints: [...UNIVERSAL_CONSTRAINTS, "no battle wounds", "no dark or horror styling"],
    modelPreference: "lucy-restyle-2",
    active: true,
    featured: false,
    priceCents: DEFAULT_PRICE_CENTS,
    maxGenerationSeconds: 15,
    audience: "all_ages",
    sortOrder: 20,
    theme: "anime",
  },
  {
    id: "exp_royal_fantasy",
    slug: "royal-fantasy",
    name: { en: "Royal Fantasy", es: "Fantasía Real" },
    tagline: { en: "Rule your kingdom.", es: "Reina tu reino." },
    previewAsset: "/previews/royal-fantasy.jpg",
    referenceAsset: null,
    prompt:
      "Elegant cinematic royal portrait. Ornate golden crown, richly embroidered gold and ivory regal robes, " +
      "warm candlelit fantasy castle hall with soft bokeh columns behind, gold accents and warm amber rim light, " +
      "poised regal expression, painterly fine-art photography styling, luxurious and dignified.",
    negativeConstraints: [...UNIVERSAL_CONSTRAINTS, "no real royal family likeness", "no religious iconography"],
    modelPreference: "lucy-restyle-2",
    active: true,
    featured: false,
    priceCents: DEFAULT_PRICE_CENTS,
    maxGenerationSeconds: 15,
    audience: "all_ages",
    sortOrder: 30,
    theme: "royal",
  },
  {
    id: "exp_become_a_baby",
    slug: "become-a-baby",
    name: { en: "Become a Baby", es: "Conviértete en Bebé" },
    tagline: { en: "Tiny & adorable.", es: "Pequeño y adorable." },
    previewAsset: "/previews/become-a-baby.jpg",
    referenceAsset: null,
    prompt:
      "Playful fictional baby-styled portrait. Transform the subject into a cute cartoonish baby version with " +
      "large round cheeks, big bright eyes, a soft pastel-pink knitted outfit and a pink bow headband, " +
      "soft diffused pink studio lighting, floating hearts and sparkles, adorable joyful expression. " +
      "Keep the subject's hair colour, eye colour and skin tone recognisable. Wholesome and family-friendly.",
    negativeConstraints: [
      ...UNIVERSAL_CONSTRAINTS,
      "no photorealistic depiction of a real infant",
      "no medical or clinical imagery",
      "no distressed or crying expression",
    ],
    modelPreference: "lucy-restyle-2",
    active: true,
    featured: true,
    priceCents: DEFAULT_PRICE_CENTS,
    maxGenerationSeconds: 15,
    audience: "all_ages",
    sortOrder: 40,
    theme: "baby",
  },
];

/** Full prompt string handed to the provider, including the safety rail. */
export function buildPrompt(experience: Experience): string {
  return `${experience.prompt} Avoid: ${experience.negativeConstraints.join(", ")}.`;
}

export function findExperienceBySlug(slug: string): Experience | undefined {
  return EXPERIENCES.find((e) => e.slug === slug);
}

export function findExperienceById(id: string): Experience | undefined {
  return EXPERIENCES.find((e) => e.id === id);
}

/** Validates the whole catalogue. Called at boot and in unit tests. */
export function validateExperienceCatalogue(): void {
  for (const experience of EXPERIENCES) experienceSchema.parse(experience);

  const slugs = new Set<string>();
  const ids = new Set<string>();
  for (const experience of EXPERIENCES) {
    if (slugs.has(experience.slug)) throw new Error(`Duplicate experience slug: ${experience.slug}`);
    if (ids.has(experience.id)) throw new Error(`Duplicate experience id: ${experience.id}`);
    slugs.add(experience.slug);
    ids.add(experience.id);
  }
}
