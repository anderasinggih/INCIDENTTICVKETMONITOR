# Project Rules & Strict Guidelines - Problem Activity Dashboard

## 1. Data & Logic Authenticity (STRICT)
- **OFFICIAL DATA & LOGIC ONLY**: Never create dummy/mock data, synthetic fallbacks, hardcoded numbers, or speculative mapping logic.
- **NO ARBITRARY FALLBACKS**: If data is missing or loading, display clear empty states, error notices, or native `null`/`[]` responses.
- **STRICT ASK RULE**: If any field, schema, formula, or business process is unclear, **ALWAYS ASK THE USER DIRECTLY**. Never make assumptions or introduce false data.

---

## 2. UI / UX Design Standard: Shadcn/UI Dark (Zinc Theme)
- **DESIGN STANDARD**: All UI components and layouts must follow **shadcn/ui Dark Mode (Zinc Palette)** design tokens (reference: [shadcnspace.com](https://shadcnspace.com/)).
- **MANDATORY `.custom-` PREFIX**:
  - Every CSS selector MUST start with `.custom-` or `.custom__` to satisfy the OWS ADC Studio UI SDK validator (*Illegal CSS Error 10010006*).
  - Never style global tags directly (`body`, `html`, `table` without `.custom-` scope).
- **PURE VANILLA CSS**: Write 100% pure vanilla CSS with zero external library dependencies.
- **SHADCN DESIGN TOKENS**:
  - Background Canvas: `#09090b` (Deep Dark Zinc)
  - Card / Panel Surface: `#0d0d10` (Border: `1px solid #27272a`, Radius: `8px`, Hover: `#3f3f46`)
  - Typography: Crisp negative letter-spacing (`-0.025em`), `tabular-nums` for numbers.
  - Text Primary: `#fafafa`
  - Text Muted: `#a1a1aa` (Labels) & `#71717a` (Descriptions)
  - Primary Action Button: White background (`#fafafa`), black text (`#09090b`), radius `6px`, `active:scale(0.98)`
  - Status Colors:
    - Info / Open: `#38bdf8`
    - Warning / Progress: `#fbbf24`
    - Success / Done: `#34d399`
    - Danger / Over SLA: `#f87171`
- **CARD COMPOSITION**:
  - Top row: Category label on the left + subtle Lucide/Feather SVG icon on the right.
  - Body: Prominent bold metric number + secondary description subtext underneath.

---

## 3. OWS Runtime & Data Extraction Rules
- **No Global JSON.parse Mutation**: Do not override `window.JSON.parse` globally. Use native responses returned by `MessageProcessor`.
- **Dynamic Field Extraction (`extractOWSField`)**: Always safely unpack OWS complex payload structures (`Array of Objects`, `Timestamp objects`).
- **Performance**: Apply debouncing (300ms) to search inputs and table filters.
