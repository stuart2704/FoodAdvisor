/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#25192A',
    tint: '#7A2E59',

    // Core surfaces
    background: '#FFF9F0',
    foreground: '#25192A',

    // Cards / elevated surfaces
    card: '#FFFFFF',
    cardForeground: '#25192A',

    // Primary action color (buttons, links, active states)
    primary: '#7A2E59',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#F3E7DC',
    secondaryForeground: '#4B2F3C',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#F3E7DC',
    mutedForeground: '#806D72',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#F2B84B',
    accentForeground: '#3B2600',

    // Destructive actions (delete, error states)
    destructive: '#ef4444',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#E8D8CC',
    input: '#E8D8CC',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 18,
};

export default colors;
