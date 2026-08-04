import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  EXPERIENCES,
  experienceSchema,
  findExperienceById,
  findExperienceBySlug,
  validateExperienceCatalogue,
} from "@/lib/config/experiences";
import { LANGUAGES, MESSAGES, createTranslator, isLanguage, translate } from "@/lib/i18n/messages";
import { formatPrice } from "@/lib/public-config";

describe("experience catalogue", () => {
  it("validates against its own schema", () => {
    expect(() => validateExperienceCatalogue()).not.toThrow();
    for (const experience of EXPERIENCES) {
      expect(() => experienceSchema.parse(experience)).not.toThrow();
    }
  });

  it("ships exactly the four pilot styles, including Become a Baby", () => {
    const slugs = EXPERIENCES.map((e) => e.slug);
    expect(slugs).toEqual(["slime-star", "anime-power-up", "royal-fantasy", "become-a-baby"]);
  });

  it("features Become a Baby as the new experience", () => {
    const baby = findExperienceBySlug("become-a-baby");
    expect(baby?.featured).toBe(true);
    expect(EXPERIENCES.filter((e) => e.featured)).toHaveLength(1);
  });

  it("prices every style at $5.99", () => {
    for (const experience of EXPERIENCES) expect(experience.priceCents).toBe(599);
  });

  it("marks every style as all-ages", () => {
    for (const experience of EXPERIENCES) expect(experience.audience).toBe("all_ages");
  });

  it("caps generation at 15 seconds per style", () => {
    for (const experience of EXPERIENCES) {
      expect(experience.maxGenerationSeconds).toBeLessThanOrEqual(15);
    }
  });

  it("carries the universal safety constraints on every style", () => {
    const required = ["no nudity", "no real-world celebrity likeness", "no branded or trademarked characters"];
    for (const experience of EXPERIENCES) {
      for (const constraint of required) {
        expect(experience.negativeConstraints).toContain(constraint);
      }
    }
  });

  it("appends the constraints to the prompt sent to the provider", () => {
    for (const experience of EXPERIENCES) {
      const prompt = buildPrompt(experience);
      expect(prompt).toContain(experience.prompt);
      expect(prompt).toContain("Avoid:");
      expect(prompt).toContain("no nudity");
    }
  });

  it("names no celebrity or franchise in any prompt", () => {
    // A crude but useful tripwire: these are the words most likely to appear if
    // someone edits a prompt toward impersonation.
    const banned = ["disney", "pixar", "marvel", "pokemon", "barbie", "taylor swift", "kardashian"];
    for (const experience of EXPERIENCES) {
      const haystack = `${experience.prompt} ${experience.name.en} ${experience.name.es}`.toLowerCase();
      for (const word of banned) expect(haystack).not.toContain(word);
    }
  });

  it("presents Become a Baby as fiction, never as a prediction", () => {
    const baby = findExperienceBySlug("become-a-baby");
    expect(baby?.prompt.toLowerCase()).toContain("fictional");
    expect(baby?.negativeConstraints).toContain("no photorealistic depiction of a real infant");
  });

  it("looks styles up by slug and id", () => {
    expect(findExperienceBySlug("slime-star")?.id).toBe("exp_slime_star");
    expect(findExperienceById("exp_slime_star")?.slug).toBe("slime-star");
    expect(findExperienceBySlug("nope")).toBeUndefined();
  });
});

describe("translations", () => {
  it("has both required languages", () => {
    expect(LANGUAGES).toEqual(["en", "es"]);
  });

  it("translates every English key into Spanish", () => {
    const missing = Object.keys(MESSAGES.en).filter((key) => {
      const value = MESSAGES.es[key as keyof typeof MESSAGES.es];
      return !value || value.trim() === "";
    });
    expect(missing).toEqual([]);
  });

  it("has no untranslated Spanish strings that merely copy the English", () => {
    // Brand names legitimately stay identical across languages.
    const allowedIdentical = new Set(["brand.name", "attract.languageEnglish", "attract.languageSpanish"]);
    const suspicious = Object.keys(MESSAGES.en).filter((key) => {
      const typed = key as keyof typeof MESSAGES.en;
      return !allowedIdentical.has(key) && MESSAGES.en[typed] === MESSAGES.es[typed];
    });
    expect(suspicious).toEqual([]);
  });

  it("substitutes placeholders", () => {
    expect(translate("en", "delivery.expires", { hours: 24 })).toContain("24");
    expect(translate("es", "delivery.expires", { hours: 12 })).toContain("12");
    expect(translate("en", "generating.secondsLeft", { seconds: 7 })).toContain("7");
  });

  it("leaves an unknown placeholder intact rather than printing undefined", () => {
    expect(translate("en", "delivery.expires", { wrong: 1 })).toContain("{hours}");
  });

  it("carries the required brand copy", () => {
    expect(MESSAGES.en["brand.tagline"]).toBe("STEP IN. BECOME ANYTHING.");
    expect(MESSAGES.en["attract.start"]).toBe("START");
    expect(MESSAGES.es["attract.start"]).toBe("EMPEZAR");
    expect(MESSAGES.en["brand.poweredBy"]).toContain("LUCY");
    expect(MESSAGES.en["delivery.title"]).toBe("YOUR PHOTO IS READY!");
  });

  it("promises payment protection in the staff-help copy, in both languages", () => {
    expect(MESSAGES.en["error.staff"]).toContain("payment is protected");
    expect(MESSAGES.es["error.staff"]).toContain("pago está protegido");
  });

  it("builds a working translator", () => {
    const t = createTranslator("es");
    expect(t("attract.start")).toBe("EMPEZAR");
  });

  it("validates language codes", () => {
    expect(isLanguage("en")).toBe(true);
    expect(isLanguage("fr")).toBe(false);
    expect(isLanguage(undefined)).toBe(false);
  });
});

describe("pricing display", () => {
  it("formats the pilot price", () => {
    expect(formatPrice(599)).toBe("$5.99");
    expect(formatPrice(1000)).toBe("$10.00");
  });
});
