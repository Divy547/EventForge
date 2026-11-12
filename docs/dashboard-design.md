# EventForge — Dashboard Design

> Moved out of `PLAN.md` on 2026-11-12. Read only for Phase 2 tasks 3 (landing page) and 11
> (responsive and theming pass).

## Design (decided 2026-11-12)

- **Direction C, "Pipeline", re-themed black & white (2026-11-12).** Black header; Overview opens with a hero showing the flow
  _Ingested → Fanned out → Outcome_ (completed, in flight, retrying, dead letter); below it a subscription
  health list (success rate per subscription) and a live activity feed. Headings in Fraunces (serif), body in
  Inter, numbers and IDs in JetBrains Mono (all bundled). Primary is black (inverted to white in dark mode) and buttons are
  outline-style; red is the only colour, kept for failure states. Colours live as CSS variables in `src/index.css`. Status colours are always paired with a text label, never colour alone.
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
