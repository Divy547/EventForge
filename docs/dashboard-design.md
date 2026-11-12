# EventForge — Dashboard Design

> Moved out of `PLAN.md` on 2026-11-12. Read only for Phase 2 tasks 3 (landing page) and 11
> (responsive and theming pass).

## Design (decided 2026-11-12)

- **Direction C, "Pipeline".** Dark navy header; Overview opens with a hero showing the flow
  _Ingested → Fanned out → Outcome_ (completed, in flight, retrying, dead letter); below it a subscription
  health list (success rate per subscription) and a live activity feed. Headings in Space Grotesk, body in
  Inter, numbers and IDs in JetBrains Mono (all bundled). Accent orange for primary actions (white-on-`#C2410C`
  keeps 4.5:1 contrast). Status colours are always paired with a text label, never colour alone.
- **Shared rules:** touch targets at least 44 px; visible focus; real `<button>`/`<a>`/`<label>` elements;
  usable at phone width (nav wraps, tables scroll in a box); light and dark theme through shadcn CSS variables.
- **Landing page explainer animation** (`motion`, loops about 16 s; mockup on the canvas above). One event travels:
  your app → API (`202 Accepted`) → outbox (saved in one transaction) → worker → three endpoints. One endpoint
  succeeds, one returns `503` and succeeds on retry after "wait 4 s + jitter", one runs out of retries and lands in
  the dead-letter queue. Five captions stay in sync with the steps. It has a **Pause/Play** button; with reduced
  motion it shows a static diagram with all captions visible. On phones the diagram scrolls sideways instead of
  shrinking. The endpoint names and retry story are illustrative, not live data.
- **Proposed shadcn components** (added as needed, not all up front): Button, Input, Label, Card, Table, Badge,
  Tabs, Select, Switch, Dialog, Sheet, Skeleton, Sonner (toasts), Pagination, DropdownMenu, Chart.
