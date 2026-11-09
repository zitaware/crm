# UI Design System and HTML Fidelity Rules

## 1. Purpose

This document is the mandatory visual implementation standard for Zitaware CRM.
It converts the supplied static HTML prototype into one reusable design system
for the Next.js application.

The supplied HTML must be followed closely for:

- visual hierarchy;
- page composition;
- navigation concepts;
- colors and status semantics;
- typography;
- spacing and density;
- cards, forms, grids, tables and tabs;
- field grouping and label placement;
- desktop appearance and interaction intent.

Do not redesign the application, replace its visual identity, apply a generic
Ant Design theme, or invent page-specific styles.

Minor changes are permitted only when required by:

- `04-screen-contracts.md`;
- confirmed business or accounting rules;
- permissions and security;
- accessibility;
- responsive adaptation;
- validation or reconciliation integrity.

Every approved deviation must preserve the closest possible visual structure
and be recorded in the implementation task.

## 2. Source inventory and authority

The reviewed prototype contains:

- 103 business screens;
- `01-platform/shell.html`, the canonical shared-shell reference;
- `01-platform/index.html`, a prototype/reference entry page;
- `01-platform/fonts.html`, a font-comparison page only;
- matching desktop screenshots captured at `1440 × 900`.

Use the sources as follows:

| Source | Authority |
|---|---|
| `01-platform/shell.html` | Canonical tokens, shell, shared component proportions and responsive breakpoint |
| Paired business HTML file | Page-specific fields, ordering, grouping and interactions |
| Paired `1440 × 900` screenshot | Golden desktop visual reference |
| `04-screen-contracts.md` | Required functional corrections and screen disposition |
| This document | Shared UI tokens, component implementation and consistency rules |
| `fonts.html` | Comparison/reference only; it does not select a production font |

If sources conflict, business rules and screen contracts win over a sample
calculation or unsafe interaction. For purely visual conflicts, use
`shell.html` for shared components and the paired screen for page-specific
composition.

## 3. Non-negotiable UI rules

1. Use Ant Design as the component foundation.
2. Use Tailwind CSS for layout, spacing, responsive behavior and approved
   utility styling around Ant Design components.
3. Use the exact semantic palette in this document.
4. Centralize all tokens in `packages/ui/theme`; never repeat a full token block
   inside individual screens.
5. Build reusable patterns, not one React component per HTML file.
6. Do not paste the prototype's repeated page-level CSS or inline JavaScript.
7. Do not use arbitrary new colors, gradients, shadows, radii or font families.
8. Do not replace the compact enterprise density with Ant Design defaults when
   those defaults visibly differ from the prototype.
9. Do not calculate financial totals independently in React.
10. Do not hide a backend validation or permission failure merely to preserve a
    static screenshot.
11. Desktop implementation must remain visually recognizable against its
    paired `1440 × 900` screenshot.
12. New screens must look as though they belonged to the supplied prototype.

## 4. Visual character

The visual language is:

- formal, compact and operational;
- Zitaware navy for structure and authority;
- Zitaware navy (the sidebar color) for primary buttons and selected chips;
- Zitaware blue for links, focus and section labels;
- Zitaware yellow for active-state highlights (active navigation, active tab,
  auth card edge) — never for text on white, where it is unreadable;
- white surfaces on a cool paper background;
- restrained shadows and fine borders;
- color used semantically, especially for money and workflow states;
- information-dense without decorative clutter.

Avoid:

- oversized headings or controls;
- excessive whitespace;
- large rounded “consumer app” cards;
- bright gradients outside the small brand mark;
- glass, blur, neon or heavy shadows;
- colorful module-by-module themes;
- center-aligned enterprise tables;
- decorative illustrations in working screens.

## 5. Canonical design tokens

### 5.1 Core colors

These are the Zitaware Solutions brand colors (ADR-191). They replace the
prototype palette in `shell.html`; layout, spacing and fields still follow the
prototypes.

| Token | Hex | Required use |
|---|---:|---|
| `ink` | `#0a1b4d` | Sidebar, primary buttons and selected chips (hover `ink-2`), strongest headings, dark totals, selected pagination |
| `ink-2` | `#13296b` | Sidebar hover/active background, ink-button hover |
| `ink-3` | `#1d3a8a` | Elevated sidebar interaction when required |
| `paper` | `#f5f7fa` | Application background, subtle panels, table headers |
| `surface` | `#ffffff` | Cards, tables, inputs, header surfaces |
| `line` | `#e3e8f0` | Main borders |
| `line-2` | `#eef1f5` | Row dividers and light separators |
| `text` | `#1e293b` | Normal body text |
| `muted` | `#5b6a82` | Secondary text, labels and inactive controls |
| `muted-2` | `#94a3bb` | Tertiary text, placeholder-like metadata |
| `brand` | `#0f5bff` | Links, focus, section labels, accent tints |
| `brand-hover` | `#0b4de0` | Brand button hover |
| `brand-dark` | `#083db5` | Pressed/darkest brand step |
| `brand-soft` | `#e8efff` | Brand tint, selected segments, avatar background |
| `highlight` | `#ffc700` | Active navigation bar, active tab ink bar, auth card edge |
| `highlight-soft` | `#fff6d1` | Text selection and yellow tints |
| `amber` | `#ff8a00` | Brand gradient partner of `highlight` only |
| `row-hover` | `#fafbfc` | Table/card row hover |
| `sidebar-text` | `#c3cce0` | Sidebar navigation text |
| `sidebar-group` | `#8391b4` | Sidebar group labels |

### 5.2 Semantic colors

| Semantic token | Foreground | Soft background | Meaning |
|---|---:|---:|---|
| `positive` | `#1f7a52` | `#e4f3ec` | Received, paid, approved, credit, profit, completed |
| `negative` | `#b23b3b` | `#f7e6e6` | Overdue, rejected, debit, deduction, loss, destructive |
| `warning` | `#b07d1a` | `#f8efd9` | Pending, due, in progress, hold, attention |
| `information` | `#2c6390` | `#e4eef6` | Request, free, informational, physical progress |
| `purple` | `#6b4d9e` | `#ece5f6` | Lead-specific alternate status only where shown |
| `neutral` | `#5b6a82` | `#eef1f5` | Draft, inactive, unavailable, not started |

Color communicates meaning; it must not be the only indicator. Every status
also requires visible text and, where helpful, the prototype's small dot.

Do not use green for a neutral action, red for decoration, or brand as a generic
warning.

### 5.3 CSS variables

Define these once in the shared global theme:

```css
:root {
  --ui-ink: #0a1b4d;
  --ui-ink-2: #13296b;
  --ui-ink-3: #1d3a8a;
  --ui-paper: #f5f7fa;
  --ui-surface: #ffffff;
  --ui-line: #e3e8f0;
  --ui-line-2: #eef1f5;
  --ui-text: #1e293b;
  --ui-muted: #5b6a82;
  --ui-muted-2: #94a3bb;
  --ui-brand: #0f5bff;
  --ui-brand-hover: #0b4de0;
  --ui-brand-dark: #083db5;
  --ui-brand-soft: #e8efff;
  --ui-highlight: #ffc700;
  --ui-highlight-soft: #fff6d1;
  --ui-amber: #ff8a00;
  --ui-positive: #1f7a52;
  --ui-positive-soft: #e4f3ec;
  --ui-negative: #b23b3b;
  --ui-negative-soft: #f7e6e6;
  --ui-warning: #b07d1a;
  --ui-warning-soft: #f8efd9;
  --ui-information: #2c6390;
  --ui-information-soft: #e4eef6;
  --ui-purple: #6b4d9e;
  --ui-purple-soft: #ece5f6;
  --ui-row-hover: #fafbfc;
  --ui-sidebar-text: #c3cce0;
  --ui-sidebar-group: #8391b4;
  --ui-radius: 7px;
  --ui-radius-sm: 5px;
  --ui-shadow:
    0 1px 2px rgb(10 27 77 / 6%),
    0 1px 3px rgb(10 27 77 / 4%);
  --ui-shadow-pop: 0 8px 28px rgb(10 27 77 / 16%);
  --ui-sidebar-width: 252px;
  --ui-topbar-height: 56px;
}
```

### 5.4 Radius, border and shadow

| Element | Rule |
|---|---|
| Standard card/button/segment | `7px` radius |
| Input/select/textarea | `5px` radius |
| Small tags | `4px` radius |
| Status pill | `20px` radius |
| Avatar | Circular, except square entity initials shown in tables |
| Standard border | `1px solid #e3e8f0` |
| Light divider | `1px solid #eef1f5` |
| Card shadow | Canonical `--ui-shadow` only |
| Popover/modal shadow | Canonical `--ui-shadow-pop` only |

Do not increase the global radius to Ant Design's larger defaults.

## 6. Typography and numeric formatting

### 6.1 Font families

```text
Display and body (Zitaware brand typeface, ADR-191):
'Plus Jakarta Sans' (self-hosted by next/font as --font-jakarta),
-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
'Helvetica Neue', Arial, sans-serif

Numeric/monospace:
'SF Mono', 'Cascadia Mono', Consolas, monospace
```

`fonts.html` compares alternatives such as Sora, Space Grotesk and Manrope. It
does not authorize using those fonts in production. Changing the production
font requires a recorded design decision.

### 6.2 Type scale

| Role | Size | Weight | Other |
|---|---:|---:|---|
| Root/body | `14px` | `400` | `line-height: 1.45` |
| Page title | `23px` | `700` | Display family, ink |
| Record title | `21px` | `700` | Display family, `1.15` line height |
| Major tile value | `25–26px` | `700` | Display family, tabular numerals |
| Money-strip value | `17px` | `700` | Display family |
| Secondary money value | `19px` | `700` | Display family |
| Card heading | `14px` | `700` | Ink |
| Body/control text | `13px` | `400–600` | Body family |
| Field label | `12–12.5px` | `600` | Text color |
| Secondary metadata | `12px` | `400–600` | Muted |
| Table heading | `11px` | `700` | Uppercase, `.04em` tracking |
| Section heading | `11px` | `700` | Brand, uppercase, `.06em` tracking |
| Sidebar group | `10px` | `700` | Uppercase, `.09em` tracking |
| Small helper/tag | `11–11.5px` | `400–600` | Muted or semantic color |

### 6.3 Financial numbers

- Right-align numeric table columns.
- Use tabular numerals for amounts, counts, percentages, invoice references and
  dates where alignment matters.
- Use the numeric/monospace family for table amounts and calculation panels.
- Display INR using Indian digit grouping, for example `₹1,20,00,000`.
- Use `Cr` and `L` only in summary tiles where the paired HTML abbreviates the
  amount. Detail screens and exports must show the complete amount.
- Display percentages consistently with the required precision.
- Never use color alone to distinguish debit from credit.
- UI formatting receives decimal strings; it must not introduce binary
  floating-point calculations.

## 7. Ant Design and Tailwind ownership

### 7.1 Ant Design owns

- buttons and icon buttons;
- form items and validation presentation;
- inputs, textareas, selects, date pickers and input numbers;
- checkboxes, radio controls, switches and segmented controls;
- tables, sorting, pagination and empty states;
- tabs;
- cards where the standard card contract is sufficient;
- uploads;
- dropdowns, tooltips, popovers, drawers and modals;
- alerts, messages, notifications, skeletons and results;
- progress indicators.

### 7.2 Tailwind owns

- application and page layout;
- fixed shell dimensions;
- grid and flex composition;
- gaps, padding and width constraints;
- breakpoint-specific stacking and visibility;
- stable wrapper classes around Ant Design components;
- the special project record header and finance waterfall composition;
- small semantic text/alignment utilities.

Do not recreate `Button`, `Input`, `Select`, `DatePicker`, `Table`, `Pagination`,
`Modal`, `Drawer`, `Upload` or `Tabs` as independent Tailwind components.

### 7.3 Theme requirement

The root application must use one Ant Design `ConfigProvider`. At minimum, map:

```ts
const theme = {
  token: {
    colorPrimary: '#0a1b4d',
    colorPrimaryHover: '#13296b',
    colorPrimaryActive: '#050f30',
    colorLink: '#0f5bff',
    colorLinkHover: '#0b4de0',
    colorSuccess: '#1f7a52',
    colorWarning: '#b07d1a',
    colorError: '#b23b3b',
    colorInfo: '#2c6390',
    colorText: '#1e293b',
    colorTextSecondary: '#5b6a82',
    colorTextTertiary: '#94a3bb',
    colorBorder: '#e3e8f0',
    colorSplit: '#eef1f5',
    colorBgLayout: '#f5f7fa',
    colorBgContainer: '#ffffff',
    borderRadius: 7,
    borderRadiusSM: 5,
    controlHeight: 36,
    controlHeightSM: 30,
    fontSize: 14,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, ' +
      '"Helvetica Neue", Arial, sans-serif',
  },
  components: {
    Layout: {
      bodyBg: '#f5f7fa',
      headerBg: '#ffffff',
      siderBg: '#0a1b4d',
    },
    Menu: {
      darkItemBg: '#0a1b4d',
      darkItemColor: '#c3cce0',
      darkItemHoverBg: '#13296b',
      darkItemSelectedBg: '#13296b',
      darkItemSelectedColor: '#ffffff',
    },
    Table: {
      headerBg: '#f5f7fa',
      headerColor: '#5b6a82',
      rowHoverBg: '#fafbfc',
      borderColor: '#e3e8f0',
    },
    Tabs: {
      itemColor: '#5b6a82',
      itemSelectedColor: '#0a1b4d',
      itemActiveColor: '#0a1b4d',
      inkBarColor: '#ffc700',
    },
    Input: {
      activeBorderColor: '#0f5bff',
      hoverBorderColor: '#0f5bff',
      activeShadow: '0 0 0 3px #e8efff',
    },
    Select: {
      activeBorderColor: '#0f5bff',
      hoverBorderColor: '#0f5bff',
      activeOutlineColor: '#e8efff',
    },
  },
} satisfies ThemeConfig;
```

Confirm token-property compatibility when the exact Ant Design version is
pinned. Preserve the values and visual outcome if a property name differs.

Tailwind must expose semantic names such as `bg-app`, `bg-surface`, `text-ink`,
`text-muted`, `border-ui`, `text-positive` and `bg-brand-soft`. Do not scatter
hex values through feature components.

## 8. Application shell

### 8.1 Desktop frame

| Part | Required dimensions/behavior |
|---|---|
| App | Two columns: `252px 1fr`; minimum height `100vh` |
| Sidebar | `252px` (ADR-191: fits the brand name on one line), sticky, full viewport height, independently scrollable |
| Top bar | `56px`, sticky, white, bottom border, `22px` horizontal padding |
| Main | Flexible column with `min-width: 0` |
| Content | `22px` padding, `1500px` maximum width, full available width |

### 8.2 Sidebar

- Background is `ink`.
- Brand area uses `16px 18px` padding.
- Brand mark is the `30 × 30px` Zitaware Z (`/logo-mark.png`, white and yellow on
  transparent), or the user's legal entity logo/initials (ADR-188).
- Brand name is `16px`; subtitle is uppercase `10px`.
- Group labels use `12px 18px 5px` padding.
- Navigation rows use `7px 18px`, `13px` text and `16px` icons.
- Active navigation uses `ink-2`, white text and a `3px` highlight (yellow) left border.
- Hover uses `ink-2` and white text.
- Badges use brand with white `10px` text.
- Nested navigation preserves the compact indented style shown in the HTML.
- Menu items are generated from centralized route definitions and filtered by
  permissions. Static prototype links are not copied.

### 8.3 Top bar

- Breadcrumbs remain on the left.
- Search is right-aligned, approximately `260px` wide on desktop.
- Search, notification and user presentation must follow the HTML order.
- Icon buttons are `34 × 34px`.
- Avatar is `32 × 32px`, circular, brand-soft background and brand initials.
- The notification dot is red and must include an accessible label.
- Top-bar content must not cause the page to exceed viewport width.

## 9. Page composition and grids

### 9.1 Page header

Use one shared `PageHeader`:

- title and description on the left;
- actions on the right;
- `16px` gap between groups;
- `18px` bottom margin;
- title `23px/700`;
- description `13px`, muted, `3px` top margin;
- actions separated by `9px`;
- actions wrap below the title when space is insufficient.

### 9.2 Width patterns

Choose the pattern used by the paired HTML:

| Pattern | Width/composition | Typical screens |
|---|---|---|
| Wide data | Content up to `1500px` | Lists, dashboards, reports |
| Form | Full content width (up to `1500px`) | All add/edit forms — see the 2026-09-01 amendment below |
| Wide finance form | `1fr 340–360px` at full content width | Receipt/payment and calculation screens |
| Detail split | `1fr 340px`, `18px` gap | Project/financial detail pages |
| Master/detail split | `300–360px 1fr` | Screens whose paired HTML uses a selector/list beside detail |

**Amendment, 2026-09-01 (ADR-102) — forms use the full content width.**
This table previously specified `920–1040px` for standard forms and
`760–860px` for focused ones, and instructed: *"Do not stretch narrow forms
across the full data-page width."* The product owner reviewed the rendered
result and overrode it: forms now fill the content column like every other
page.

The original rule was not arbitrary — an unconstrained text input at
`1500px` is genuinely harder to scan, which is why the cap existed. Two
things make the override reasonable in practice: the caps were applied
without centring, so every form sat hard-left with several hundred pixels of
dead space down one side, which read as a layout fault rather than a
deliberate measure; and §9.3's two-column form grid already halves the
effective width of most fields, so a field is rarely as wide as the page.
Fields that genuinely want to stay short (an amount, a date, a code) should
be constrained individually rather than by capping the whole form.

Right-aligned totals panels keep their own narrow width (`max-w-xs`) — they
are summaries, not form input, and were never part of this rule.

### 9.3 Form grid

The canonical form grid is:

```text
Desktop: 2 equal columns
Vertical gap: 15–16px
Horizontal gap: 20–22px
Full-width field: spans both columns
At/below 980px: 1 column
```

Use a named `FormGrid` variant when a paired screen requires a different
column layout. Do not use one-off inline `grid-template-columns`.

### 9.4 Dashboard and report grids

- Summary tiles normally use four equal columns at wide desktop sizes.
- Report index cards use three equal columns.
- Generic tile grids may use `repeat(auto-fit, minmax(190px, 1fr))`.
- Dashboard content commonly uses a main area with a `340px` side card.
- Preserve the paired screen's card order.
- Cards stack at narrower widths without changing data meaning.

## 10. Buttons and actions

### 10.1 Base button

The visible target is:

```text
Font: 13px / 600
Padding: 8px 14px
Radius: 7px
Icon: 15px
Icon/text gap: 7px
Border: 1px
Compact height: approximately 34–36px
```

### 10.2 Button hierarchy

| Variant | Appearance | Use |
|---|---|---|
| Primary CTA | Ink (sidebar navy) background and border, white text; `ink-2` on hover | Create, Add, Apply, Save, Submit, Record, Raise Invoice |
| Secondary | White surface, line border, normal text | Export, Reset, Close, auxiliary actions |
| Text/Ghost | Transparent, muted text | Back, Cancel and low-emphasis navigation |
| Danger | White/transparent with negative text; negative-soft hover | Delete, reject, cancel/void when destructive |
| Small | `5px 10px`, `12px` | Table/card actions |
| Icon-only | `28–34px` square depending on context | Row view/edit, notification and compact toolbar action |
| Inline add | Paper background, dashed line border, brand text | Add contact, penalty or repeatable row |

Rules:

- Use one prominent brand CTA per action group.
- Put the primary CTA at the right edge.
- Place Cancel/Back before Save/Submit.
- Loading disables repeat submission and retains the button width.
- Disabled actions need a reason through help text or tooltip when the reason is
  not obvious.
- Destructive actions require confirmation and must not use the brand style.
- Icon-only actions require tooltips and accessible names.
- Do not use the dark ink style as a general CTA. Ink is reserved for structural
  emphasis such as the selected pagination page and the final finance total.

## 11. Cards, tiles and panels

### 11.1 Standard card

```text
Background: surface
Border: 1px solid line
Radius: 7px
Shadow: canonical card shadow
Header: 13px 16px
Body: 16px
Form body: 22px 24px where shown
Header divider: line-2
```

Card headings are `14px/700`. Header actions sit at the far right with an `8px`
gap.

### 11.2 Statistic tile

- Use `15px 16px` padding.
- Label is uppercase `11.5px/600`, muted, `.05em` tracking.
- Optional icon container is `26 × 26px`, `6px` radius.
- Value is `25–26px/700`, ink, display family.
- Supporting line is `12px`, muted.
- Positive/negative portions use semantic colors.
- A top accent border is allowed only where the paired dashboard/report uses
  it.
- Hover lift is subtle: at most `-1px` with a light shadow.

### 11.3 Informational banner

Use Ant Design `Alert` styled to match:

- information-soft background;
- subtle blue border;
- `7px` radius;
- compact `11px 14px` padding;
- `12.5px` text;
- icon approximately `17px`.

Use warning, error and success variants with their semantic palettes.

## 12. Forms

### 12.1 Field anatomy

- Label: `12–12.5px/600`, text color, `5–6px` bottom margin.
- Required marker: negative red.
- Control: `13px`, `36px` normal target height.
- Form controls use white background, line border and `5px` radius.
- Form input padding visually matches `9px 11px`.
- Help/hint: `11.5px`, muted, `4–5px` top margin.
- Textarea: minimum `74–78px`, vertical resize only.
- Placeholder: tertiary/muted and never used as the only field label.
- Focus: brand border plus `0 0 0 3px brand-soft`.

### 12.2 Form sections

Section labels must preserve the HTML treatment:

- `11px/700`;
- uppercase;
- `.06em` tracking;
- brand text;
- full grid width;
- bottom divider;
- approximately `8–9px` bottom padding;
- `6–8px` top margin except the first section.

Do not replace these section labels with oversized card titles.

### 12.3 Form footer

- Separates from fields with a `line-2` top border.
- Uses paper background when shown in the paired HTML.
- Actions align right with a `10px` gap.
- Required-field note or supporting information stays left.
- On small screens, actions may stack full-width while keeping primary last.

### 12.4 Control rules

- Use `Form.Item` for labels, validation and help.
- Use Zod-derived validation rules and render server errors at the field or form
  level.
- Selects use searchable mode for long master lists.
- Dates display as `DD/MM/YYYY`; API values remain ISO dates.
- Use `MoneyInput` built on Ant Design `InputNumber` with decimal-string
  handling and Indian display formatting.
- Use separate fields for CGST, SGST, IGST, TDS, GST-TDS, hold, retention and
  penalties where the screen contract requires them.
- Read-only invoice/tax/source values must look deliberate, remain selectable,
  and must not be submitted as user-authored amounts.
- Never use a numeric input for phone numbers, PIN codes, GSTINs, bank account
  numbers or document references.
- Repeatable row groups use a bordered container, line dividers and a small
  inline-add action, matching contact and penalty rows.

### 12.5 Segmented controls

- Outer border uses `line`, `7px` radius.
- Items are `12.5px/600`, muted, compact.
- Selected item uses brand-soft background and brand text.
- Keep one selected state visible.
- Use Ant Design `Segmented` or `Radio.Group`; do not implement hidden inputs
  with manual DOM scripts.

### 12.6 Uploads

Use `Upload`/`Upload.Dragger` with the prototype treatment:

- `1.5px` dashed line border;
- `7px` radius for compact uploads and `9px` for the large document drop zone;
- centered muted text;
- brand border and optional brand-soft background on hover;
- success changes to a solid positive border with positive-soft background;
- accepted file types and size limits displayed before upload;
- upload progress, retry, remove and server error states included;
- uploaded files remain linked to the relevant domain record and permissions.

## 13. Data grids and tables

All list/report grids use the shared `DataTable` wrapper around Ant Design
`Table`.

### 13.1 Table style

| Element | Required style |
|---|---|
| Table body | `13px` |
| Header | `11px/700`, uppercase, `.04em`, muted |
| Header background | Paper |
| Header padding | Approximately `10px 14px` |
| Body padding | Approximately `11px 14px` |
| Main border | Line |
| Row divider | Line-2 |
| Row hover | `#fafbfc` |
| Primary cell | `600`, ink |
| Secondary line | `12px`, muted |
| Numeric cell | Right aligned, `12.5px`, monospace/tabular |
| Action cell | Right aligned, compact icon buttons |

### 13.2 Filter bar

- Lives inside the table card above the header row.
- Uses `12px 16px` padding.
- Controls align to the bottom.
- Filters wrap with a `9px` gap.
- Filter labels are uppercase `10.5px/600`, muted, `.04em`.
- Apply is brand; Reset is secondary.
- Export remains in the page header unless the paired screen places it in the
  grid toolbar.
- Filter values must be represented in the URL or an approved saved-filter
  state where users need refresh/share continuity.

### 13.3 Sorting, pagination and overflow

- Sorting and filtering are server-backed for paginated data.
- Pagination remains inside the table card.
- Pager uses `12px 16px`, line-2 top border and `12.5px` muted text.
- Selected page uses ink background and white text.
- Page buttons are approximately `30 × 30px`.
- Show page size and result range where the HTML does.
- Tables fit their card: long text wraps onto the next line and related
  figures may stack in one cell. A table scrolls horizontally only when its
  columns cannot fit even wrapped (e.g. on a phone); do not squeeze columns
  until data becomes unreadable. Do not size a table to `max-content` or a
  fixed pixel width, which stops wrapping and scrolls on a desktop too.
- Sticky headers are permitted inside a bounded table scroll container.
- Preserve stable column order from the paired HTML unless the screen contract
  requires a correction.
- Use a stable domain ID as `rowKey`.

### 13.4 Row actions

- Use view/edit/download/more icons consistent with the prototype.
- Action buttons are approximately `28 × 28px`.
- Show a visible focus state.
- Tooltip text states the action.
- Permission-denied actions are omitted; temporarily unavailable actions may be
  disabled with an explanation.
- Destructive actions do not appear as an unlabeled icon without confirmation.

## 14. Status pills, tags and badges

### 14.1 Status pill

```text
Display: inline-flex
Font: 11.5px / 600
Padding: 3px 9px
Radius: 20px
Gap: 5px
Dot: 6 × 6px
```

Use the semantic mapping in section 5.2. Status text comes from the canonical
state machine, not hard-coded presentation strings spread across pages.

### 14.2 Tag

Tags are more compact than status pills:

```text
Font: 11px / 600
Padding: 2px 8px
Radius: 4px
```

Use tags for classifications such as Paid/Free/R&D or compact reference
attributes. Use status pills for lifecycle states.

### 14.3 Count badge

- Small count badges may use brand or information-soft depending on context.
- Sidebar pending count uses brand with white text.
- A zero count should not receive warning emphasis unless zero is exceptional.

## 15. Navigation, tabs and record headers

### 15.1 Breadcrumbs

- Use `12.5px` text.
- Ancestors are muted links.
- Current page is `600` normal text.
- Separators use muted-2.
- Breadcrumbs must reflect actual routes, not decorative labels.

### 15.2 Project/record header

Project-scoped screens use one shared `RecordHeader` matching the supplied
project pages:

- white surface with bottom border;
- `16px 22px 0` padding;
- `46 × 46px` record initials tile, `10px` radius;
- record title `21px/700`;
- metadata row `12.5px`, muted, wrapping as needed;
- right-aligned record actions;
- money/progress strip below metadata;
- contextual tabs below the strip.

The money strip:

- is one bordered, `7px`-radius surface;
- divides metrics with line-2 vertical borders;
- uses `11px` uppercase labels and `17px` values;
- uses semantic colors only for meaningful positive/negative values;
- uses `5px` compact progress bars where shown.

### 15.3 Tabs

- Text is `12.5–13px`.
- Inactive text is muted.
- Active text is ink and `600–700`.
- Active underline is `2px` brand.
- Tabs do not use filled colored backgrounds unless the paired HTML uses a
  segmented/queue-tab pattern.
- Project tabs scroll horizontally on narrow screens.
- Count bubbles use line-2 when inactive and brand-soft when active.
- Tab routes must be deep-linkable where each tab represents a page.

## 16. Financial UI patterns

### 16.1 Money semantics

- Positive money uses positive green only for received/credit/profit/released.
- Negative red represents deduction/debit/loss, not every expense value in
  every context.
- Pending/held/outstanding amounts use warning amber.
- Standard invoice, contract and neutral amount values remain ink.
- All source amounts, deductions and bank receipts remain separately visible.

### 16.2 Calculation waterfall

Receipt/payment screens preserve the two-column form and calculation panel:

```text
Container width: up to 1180px
Main form: flexible
Calculation panel: approximately 340–360px
Divider: line-2
Panel background: paper
```

Waterfall rules:

- row label left, amount right;
- amounts use monospace/tabular numerals;
- deductions use negative;
- additions/releases use positive;
- subtotal may use a white inset row;
- final bank receipt uses ink background, white text and stronger weight;
- the backend returns the authoritative preview;
- final submission recalculates on the backend;
- stale-preview responses block submission and request a refresh.

### 16.3 Read-only source values

Finalized invoice base value and tax components:

- are loaded from the invoice;
- cannot be re-entered on the receipt screen;
- use normal readable contrast;
- are visually grouped as source values;
- expose source invoice/milestone links where appropriate.

### 16.4 Progress bars

- Track uses line-2.
- Financial progress uses positive green.
- Physical progress uses information blue.
- Normal height is `5–6px`.
- Percentage text is tabular and visible.
- Never infer accounting settlement from physical progress.

## 17. Detail, activity and summary patterns

### 17.1 Definition list

Detail cards may use a two-column definition list:

```text
Label column: approximately 150–160px
Value column: flexible
Row padding: 9px 0
Divider: line-2
Label: 12.5px muted
Value: 13px / 500
```

On small screens, stack label above value.

### 17.2 Activity/history

When converting prototype notes/history into production:

- display actor, action and timestamp;
- use chronological ordering consistently;
- show immutable audit/source references when permitted;
- do not represent audit history as editable free text;
- use cards/list rows styled with existing borders and muted metadata.

### 17.3 Empty state

- Center inside the relevant card, not the entire application.
- Approximately `50px 20px` padding for large empty states.
- Muted icon around `40px`.
- Heading `15px`, body muted.
- Include one permitted next action where useful.

## 18. Icons

- Prefer Ant Design icons that visually match the supplied line icons.
- Use a consistent `15–16px` navigation/action size and approximately `2px`
  visual stroke weight.
- Do not mix filled, multicolor and line icon families on the same screen.
- Do not use emoji as application icons.
- Use text beside icons for primary actions.
- Icon-only controls require tooltips and accessible names.
- Preserve the supplied module meaning even if the exact prototype SVG is
  replaced by the closest Ant Design icon.

## 19. Responsive behavior

The canonical HTML shell defines `980px` as the main collapse breakpoint.

### Above `980px`

- Fixed `252px` sidebar.
- Sticky `56px` top bar.
- Paired desktop grid and form composition.
- Four-column statistic grids where shown.
- Project/record metadata and actions share one header row where space permits.

### At or below `980px`

- Sidebar becomes an off-canvas Ant Design `Drawer`.
- A menu button is added to the top bar.
- Forms change to one column.
- Wide finance/detail splits stack with the main form/content first.
- Page-header actions wrap below or beside the title without overlap.
- Tabs and dense tables scroll horizontally.
- Search flexes or moves into an accessible compact action.

### Small mobile

- Content padding may reduce from `22px` to `12–16px`.
- Cards remain bordered and do not become unrelated full-screen designs.
- Form footer buttons may become full width; primary remains last.
- Statistic grids reduce to one or two columns based on readable width.
- Table columns are not silently removed if they contain required accounting
  information. Use horizontal scroll or an approved row-detail pattern.
- Financial calculation panels stack immediately after their source fields.

The supplied screenshots are desktop references. Responsive adaptation is a
permitted minor change, but it must preserve field order, meaning and action
priority.

## 20. Accessibility and interaction states

Production screens must add states not visible in static HTML while retaining
the visual language.

### Required states

- default;
- hover;
- keyboard focus;
- active/selected;
- disabled;
- read-only;
- loading;
- empty;
- validation error;
- server error;
- success;
- stale/conflict;
- permission restricted.

### Rules

- All controls are keyboard reachable in logical order.
- Focus is visibly brand and meets contrast requirements.
- Labels are programmatically associated with fields.
- Required state is conveyed to assistive technology, not only by `*`.
- Error text identifies the field and correction.
- Tables expose proper headers and accessible action names.
- Status meaning includes text, not only color.
- Modal/drawer focus is trapped and returned to the opener.
- Loading and submission status is announced where appropriate.
- Do not reduce text contrast below the canonical muted values.

## 21. Shared component catalogue

Create these shared components before implementing many screens:

| Component | Responsibility |
|---|---|
| `AppShell` | Sidebar, top bar, responsive drawer and main content frame |
| `PermissionMenu` | Route-derived, permission-aware sidebar navigation |
| `PageHeader` | Breadcrumb context, title, description and page actions |
| `RecordHeader` | Project/entity identity, metadata, money strip and tabs |
| `UiCard` | Canonical border, radius, shadow, header and body density |
| `StatTile` | Dashboard/report metric presentation |
| `FilterBar` | Labeled filters, Apply, Reset and responsive wrapping |
| `DataTable` | AntD table defaults, server sorting/pagination and row actions |
| `StatusPill` | Canonical state-to-semantic-color mapping |
| `ClassificationTag` | Compact non-lifecycle classifications |
| `FormGrid` | Standard two-column-to-one-column form layout |
| `FormSection` | Brand uppercase divider label |
| `FormFooter` | Required note and ordered form actions |
| `MoneyInput` | Decimal-string input and Indian formatting |
| `MoneyText` | Safe amount display, alignment and semantic tone |
| `DateField` | Display/API date conversion and validation |
| `DocumentUpload` | File restrictions, progress, retry and record linkage |
| `RepeatableRows` | Contact, penalty, allocation and other repeated form rows |
| `CalculationWaterfall` | Backend-owned financial preview |
| `PermissionGate` | Presentation guard only; server remains authoritative |
| `EmptyState` | Canonical empty/next-action treatment |
| `ErrorState` | Recoverable page/card error treatment |

Wrappers must encode shared behavior or visual requirements. Do not wrap every
Ant Design component only to rename it.

## 22. Screen pattern catalogue

### List screen

```text
AppShell
└── PageHeader
    ├── title + description
    └── Export + primary Add action
└── UiCard
    ├── FilterBar
    ├── DataTable
    └── Pagination
```

Primary references: `client-list.html`, `project-list.html`,
`invoices-all.html`, `purchase-list.html`.

### Create/edit screen

```text
AppShell
└── PageHeader
    └── Back action
└── constrained UiCard
    ├── FormGrid
    │   ├── FormSection
    │   └── fields/repeatable rows
    └── FormFooter
```

Primary references: `client-add.html`, `lead-add.html`, `project-add.html`,
`purchase-request.html`.

### Project tab screen

```text
AppShell
└── RecordHeader
    ├── identity + metadata + actions
    ├── money/progress strip
    └── project tabs
└── tab content
```

Primary references: `project-detail.html`, `project-milestone.html`,
`project-invoices.html`, `project-payment.html`.

### Financial command screen

```text
AppShell
└── RecordHeader or PageHeader
└── wide finance card
    ├── FormGrid
    ├── CalculationWaterfall
    └── FormFooter
```

Primary references: `project-invoice-add.html`,
`project-payment-add.html`, `purchase-payment.html`.

### Dashboard/report screen

```text
AppShell
└── PageHeader + period controls
└── StatTile grid
└── report cards/tables/charts
```

Primary references: `dashboard.html`, `report-business-overview.html`,
`report-project-pl.html`, `reports-all.html`.

## 23. New screens

Screens missing from the prototype must reuse the closest established pattern:

| New screen | Required visual parent |
|---|---|
| Tender list/add/detail | Lead list/add/detail pattern |
| Users/Roles/Permissions | Master list plus constrained form/detail pattern |
| Approval Queue | Purchase/payment list with queue tabs and status pills |
| Optional PO | Purchase detail/form pattern |
| Goods/Service Receipt | Inventory stock-receipt/form pattern |
| Vendor Bill | Project invoice form pattern adapted for expense |
| Payment Request | Purchase payment/approval pattern |
| Credit/Debit Note | Invoice form/detail pattern |
| Bank Reconciliation | Wide table/filter pattern with a detail side panel |
| TDS Certificate Reconciliation | Report/filter table plus matching panel |
| Chart of Accounts/Ledger | Master list plus wide transaction table |
| Accounting Periods | Compact master table and controlled command modal |
| Audit Log | Wide immutable table with filters and detail drawer |

New screens must not introduce a new color system, navigation shell, page-header
style, table density or form language.

## 24. Forbidden implementation patterns

Do not:

- copy the `<style>` block from every HTML file;
- ship inline `style` attributes from the prototype;
- use CSS modules with duplicated token values per page;
- use raw hex colors inside feature components;
- mix Ant Design components with a second form/table library;
- use Tailwind to recreate standard Ant Design controls;
- let Ant Design's default blue become the primary application color;
- use random `border-radius`, box-shadow or spacing values;
- place server data in Redux when it belongs in the tRPC query cache;
- calculate GST, settlement, outstanding or profit independently in UI code;
- edit finalized source amounts from a payment/receipt form;
- hard-code role checks inside button JSX;
- use browser `alert`, `confirm` or prompt dialogs;
- omit loading, empty, error and retry states;
- remove required fields/columns solely to make a mobile layout fit;
- treat `fonts.html` as approval to choose a different font;
- change the desktop composition without a recorded reason.

## 25. Visual acceptance and review

Every implemented screen must pass:

### Desktop fidelity

- Capture at `1440 × 900`.
- Compare with the paired prototype screenshot.
- Confirm shell dimensions, content offsets, page hierarchy, card bounds,
  control density, table columns and action placement.
- Differences caused by required screen-contract corrections are documented.
- No accidental Ant Design blue, oversized control or default spacing remains.

### Responsive review

Review at least:

- `1440px` desktop;
- `1024px` compact desktop/tablet landscape;
- `980px` breakpoint boundary;
- `768px` tablet;
- `390px` mobile.

### State review

Verify:

- loading/skeleton;
- empty;
- field validation;
- server error and retry;
- disabled and read-only;
- permission-hidden actions;
- long labels and long values;
- high row count/horizontal overflow;
- success and conflict responses.

### Accessibility review

- Keyboard-only completion is possible.
- Focus remains visible.
- Labels, errors, icons, dialogs and tables have accessible names/structure.
- Status is understandable without relying on color.

### Financial review

- Backend preview equals displayed totals.
- Amounts use Indian formatting and exact decimal strings.
- Debit/credit and deduction classifications remain explicit.
- Source values cannot be silently altered.
- Exported filters and totals match the screen.

## 26. Definition of UI complete

A screen is UI-complete only when:

1. it uses the shared shell and component catalogue;
2. it follows its paired HTML and screenshot;
3. all required screen-contract corrections are present;
4. it uses centralized tokens and no unauthorized visual values;
5. desktop, responsive and interaction states are verified;
6. accessibility checks pass;
7. permissions are represented correctly in UI and enforced on the server;
8. backend-calculated financial values are displayed without independent
   recomputation;
9. visual deviations are documented and approved;
10. affected screenshot and end-to-end tests pass.

