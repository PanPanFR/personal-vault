---
version: alpha
name: Personal Vault (Catppuccin)
description: Simplified Notion-inspired personal app styling, with Notion-like layout/spaciousness and Catppuccin palette for coloring.
colors:
  base: "#EFF1F5"
  mantle: "#E6E9EF"
  crust: "#DCE0E8"
  surface0: "#CCD0DA"
  surface1: "#BCC0CC"
  surface2: "#ACB0BE"
  text: "#4C4F69"
  subtext0: "#6C6F85"
  subtext1: "#5C5F77"
  overlay0: "#9CA0B0"
  overlay1: "#8C8FA1"
  primary: "#1E66F5"
  secondary: "#8839EF"
  tertiary: "#7287FD"
  success: "#40A02B"
  warning: "#DF8E1D"
  error: "#D20F39"
  info: "#04A5E5"
rounded:
  none: 0px
  sm: 4px
  md: 8px
  lg: 12px
  xl: 24px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  base: 16px
  lg: 20px
  xl: 24px
  2xl: 28px
  3xl: 32px
  4xl: 36px
  5xl: 64px
  6xl: 80px
  section: 80px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "6px 15px"
    height: "38px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "6px 15px"
    height: "38px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "6px 15px"
  card:
    backgroundColor: "{colors.mantle}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "24px"
    borderColor: "{colors.overlay0}"
    borderWidth: "1px"
  input:
    backgroundColor: "{colors.base}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
    borderColor: "{colors.overlay0}"
    borderWidth: "1px"
  chip:
    backgroundColor: "{colors.surface0}"
    textColor: "{colors.text}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
---

# Personal Vault Design System

Simplified Notion-inspired personal app design. Keeps Notion-like layout, spacing, component restraint, but replaces coloring with Catppuccin (light default: **Latte**; optional dark: **Mocha**).

## Overview

For a single-user personal app, use the warm structured product feel (airy layout outside, dense controls inside) without marketing surfaces. Color system uses Catppuccin tokens: soft pastel/bright accents, calm surface layers, and good readability. Light mode uses Catppuccin Latte; dark mode (optional) uses Catppuccin Mocha with the same component rules.

## Colors (Catppuccin Latte — light default)

| Name | Value | Token | Role |
|------|-------|-------|------|
| Base | `#eff1f5` | `base` | Page canvas (light) |
| Mantle | `#e6e9ef` | `mantle` | Card/panel surface |
| Crust | `#dce0e8` | `crust` | Subtle lower surface |
| Surface0 | `#ccd0da` | `surface0` | Inactive fill/chip |
| Surface1 | `#bcc0cc` | `surface1` | Secondary surface |
| Surface2 | `#acb0be` | `surface2` | Higher emphasis fill |
| Text | `#4c4f69` | `text` | Primary text |
| Subtext1 | `#5c5f77` | `subtext1` | Secondary text |
| Subtext0 | `#6c6f85` | `subtext0` | Muted text |
| Overlay1 | `#8c8fa1` | `overlay1` | Border-ish/secondary control |
| Overlay0 | `#9ca0b0` | `overlay0` | Hairline borders |
| Blue | `#1e66f5` | `primary` / `blue` | Primary action accent |
| Mauve | `#8839ef` | `secondary` / `mauve` | Secondary action accent |
| Lavender | `#7287fd` | `tertiary` / `lavender` | Links/focus-friendly accent |
| Green | `#40a02b` | `success` / `green` | Success/positive |
| Yellow | `#df8e1d` | `warning` / `yellow` | Warning/caution |
| Red | `#d20f39` | `error` / `red` | Error/destructive |
| Sky | `#04a5e5` | `info` / `sky` | Info/highlight |

Dark mode (Catppuccin Mocha) equivalents:
- Base `#1e1e2e`, Mantle `#181825`, Crust `#11111b`
- Surface0 `#313244`, Surface1 `#45475a`, Surface2 `#585b70`
- Text `#cdd6f4`, Subtext1 `#bac2de`, Subtext0 `#a6adc8`
- Overlay0 `#6c7086`, Overlay1 `#7f849c`
- Blue `#89b4fa`, Mauve `#cba6f7`, Lavender `#b4befe`
- Green `#a6e3a1`, Yellow `#f9e2af`, Red `#f38ba8`, Sky `#89dceb`

Guidance:
- Primary action: Blue only (one dominant action per view).
- Secondary/ghost: Mauve or surface fills.
- Links: Lavender or Blue (less prominent).
- Borders: overlay0 at ~1px; avoid heavy shadows.
- Surfaces: base canvas, mantle cards.

## Typography

Use a Notion-inspired Inter-based sans stack. Optional editorial serif for special intros only.

- Body/UI: Inter / NotionInter / system-ui.
- Display headings: bold, tight tracking.
- Body text: 14–16px, comfortable line height.

Type scale (personal app friendly):
- `headline-lg`: 40–48px, 700, tight tracking
- `headline-md`: 28–32px, 600/700
- `heading`: 22–24px, 600
- `body`: 14–16px, 400, line-height 1.5
- `body-sm`: 12–14px, 400
- `label`: 12–14px, 500
- `caption`: 11–12px, 400/500

## Layout & Spacing

Notion-like: airy horizontal framing, clear vertical rhythm, dense interiors.

- App shell: left sidebar + main content area.
- Sidebar width: 240–280px (collapse on mobile).
- Content max width: 900–1000px for reading/writing; full width for lists/boards.
- Section spacing: 24–48px; major gaps 64–80px.
- Card padding: 16–24px.
- Use base 4px unit: 4/8/12/16/20/24/32/48/64/80.

## Elevation & Depth

Minimal depth.

- Cards: mantle surface, 1px overlay0 border, no shadow (or very subtle).
- Popovers/modals: slight shadow allowed; keep restrained.
- Focus rings: use Lavender/Blue, not heavy glow.

## Shapes

- Buttons: 8px radius.
- Cards/panels: 12px radius.
- Inputs: 8px radius.
- Pills/chips/badges: 9999px.
- Avoid over-rounding rectangular containers (>12px).

## Components

### Button
- Primary: Blue bg, white text, 8px radius, 38px height, 6px 15px padding.
- Secondary: Mauve or surface bg, text contrast, same radius.
- Ghost: transparent, text color, same radius.
- Link: transparent, Lavender/Blue text, no padding/radius.

### Card
- Mantle bg, overlay0 1px border, 12px radius, 16–24px padding.
- Clean framed surface, no heavy shadow.

### Input
- Base bg, overlay0 border, 8px radius, comfortable padding, text color.

### Chip/Pill
- Surface0 bg, text color, full radius, small padding.

### Navigation (Sidebar)
- Text links, low chrome; active item subtle surface1/mantle.
- Icons small and line-based.

### Page Title
- Bold heading, tight tracking; optional subtext muted.

### List/Item Row
- Clear hover surface (surface1), 8–12px radius.
- Status pill on right; compact spacing.

## Do's and Don'ts

### Do
- Use Catppuccin Latte tokens for light, Mocha for dark.
- Keep Blue as single primary accent; use Mauve/Lavender as supporting accents, not competing.
- Use overlay0 hairline borders instead of heavy shadows.
- Keep buttons compact (38px) and radius 8px.
- Maintain wide spacing between major app bands; dense interiors.
- Prefer text + subtle surface hierarchy for navigation.

### Don't
- Don't mix Notion blue marketing accents with Catppuccin randomly; choose a flavour consistently.
- Don't add heavy shadows/gradients to standard cards.
- Don't over-round cards (>12px) or buttons (only pills 9999px).
- Don't introduce extra accent colors beyond Catppuccin palette; keep semantic colors (green/yellow/red/sky).
- Don't use long paragraphs in titles/nav; keep scannable.
- Don't build marketing hero/landing sections in the personal app (optional separate variant if needed).

## Personal App Patterns (Recommended)

- Sidebar + top search/command bar.
- Page header: Title + actions (primary blue button).
- Content: blocks/sections with cards or plain text.
- List view: rows with status pills.
- Settings: simple cards with inputs.
- Modal/dialog: mantle surface, overlay0 border, subtle shadow.
- Empty state: small icon + short text + primary action.

## Quick Start

### CSS Custom Properties (Catppuccin Latte default)

```css
:root {
  /* Catppuccin Latte — light */
  --ctp-base: #eff1f5;
  --ctp-mantle: #e6e9ef;
  --ctp-crust: #dce0e8;
  --ctp-surface0: #ccd0da;
  --ctp-surface1: #bcc0cc;
  --ctp-surface2: #acb0be;
  --ctp-text: #4c4f69;
  --ctp-subtext0: #6c6f85;
  --ctp-subtext1: #5c5f77;
  --ctp-overlay0: #9ca0b0;
  --ctp-overlay1: #8c8fa1;
  --ctp-blue: #1e66f5;
  --ctp-mauve: #8839ef;
  --ctp-lavender: #7287fd;
  --ctp-green: #40a02b;
  --ctp-yellow: #df8e1d;
  --ctp-red: #d20f39;
  --ctp-sky: #04a5e5;

  /* App roles */
  --color-canvas: var(--ctp-base);
  --color-card: var(--ctp-mantle);
  --color-text: var(--ctp-text);
  --color-muted: var(--ctp-subtext0);
  --color-border: var(--ctp-overlay0);
  --color-primary: var(--ctp-blue);
  --color-secondary: var(--ctp-mauve);
  --color-link: var(--ctp-lavender);
  --color-success: var(--ctp-green);
  --color-warning: var(--ctp-yellow);
  --color-error: var(--ctp-red);
  --color-info: var(--ctp-sky);

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 24px;
  --radius-full: 9999px;

  /* Spacing */
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-48: 48px;
  --spacing-64: 64px;
  --spacing-80: 80px;
}

[data-theme="dark"] {
  /* Catppuccin Mocha — dark */
  --ctp-base: #1e1e2e;
  --ctp-mantle: #181825;
  --ctp-crust: #11111b;
  --ctp-surface0: #313244;
  --ctp-surface1: #45475a;
  --ctp-surface2: #585b70;
  --ctp-text: #cdd6f4;
  --ctp-subtext0: #a6adc8;
  --ctp-subtext1: #bac2de;
  --ctp-overlay0: #6c7086;
  --ctp-overlay1: #7f849c;
  --ctp-blue: #89b4fa;
  --ctp-mauve: #cba6f7;
  --ctp-lavender: #b4befe;
  --ctp-green: #a6e3a1;
  --ctp-yellow: #f9e2af;
  --ctp-red: #f38ba8;
  --ctp-sky: #89dceb;
}
```

### Tailwind (concept)

Map `ctp-*` / `color-*` tokens to Catppuccin variables; keep radius/spacing scales as above. Use `darkMode: 'class'` or data-theme selector to swap Latte/Mocha variables.