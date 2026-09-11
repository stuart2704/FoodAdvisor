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
    text: '#33221E',
    tint: '#E8562D',

    // Core surfaces
    background: '#FFF8ED',
    foreground: '#33221E',

    // Cards / elevated surfaces
    card: '#FFFFFF',
    cardForeground: '#33221E',

    // Primary action color (buttons, links, active states)
    primary: '#E8562D',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#F7E2D0',
    secondaryForeground: '#33221E',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#F3E7DC',
    mutedForeground: '#80675D',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#F4C75B',
    accentForeground: '#33221E',

    // Destructive actions (delete, error states)
    destructive: '#ef4444',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#EFDCCA',
    input: '#ECCDB2',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 18,
};

export default colors;
