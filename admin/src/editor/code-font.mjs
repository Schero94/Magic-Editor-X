/**
 * Monospace font stack for code in the admin (2.7.8). The Strapi Design System 2.3 theme has no
 * font tokens (`theme.fonts` does not exist; the DS sets only the body font globally), so the
 * plugin keeps one stack here instead of reading an undefined `theme.fonts.code`.
 */
export const CODE_FONT = "'SFMono-Regular', Menlo, Consolas, monospace";
