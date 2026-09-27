# Design system

Source of truth: `packages/design-tokens/tokens.json` → run `npm run tokens`.
Visual reference: `docs/design/ui-reference.webp`.

## Visual language
White and very light blue surfaces, soft blue gradients, large rounded cards (20pt mobile / 16px web),
subtle blue-tinted shadows, pill buttons, pastel icon circles with line icons, generous whitespace.

## Colour
| Token | Light | Use |
|---|---|---|
| `primary` | `#2A5CE0` | Links, active nav, icons, text accents |
| `primaryFill` | `#2F64EC` | Filled buttons (white text, 5.0:1) |
| `primarySoft` / `primaryTint` | `#EAF0FF` / `#DCE6FF` | Active nav background, gradients |
| `success` / `warning` / `error` | `#17783F` / `#A35600` / `#C0342A` | Status text & icons — always with an icon + label |
| `purple`, `teal` | `#6B4DE6`, `#0C766C` | Secondary accents (sleep/AI, tracking) |
| `*Soft` | pastel | Icon-badge and badge backgrounds |
| `background`, `card`, `cardMuted`, `separator` | | Surfaces |
| `textPrimary` / `textSecondary` / `textMuted` | `#101828` / `#5B6474` / `#646D80` | All ≥ 4.5:1 on white |

Every colour has a dark-mode value. Metric → tone: heart red, steps green, sleep purple, calories orange.

## Typography
| Style | Size / weight | iOS text style |
|---|---|---|
| Display | 34 / bold | `.largeTitle` |
| Page heading | 26 / bold | `.title2` |
| Section heading | 19 / semibold | `.title3` |
| Card title | 16 / semibold | `.headline` |
| Body | 15 / regular | `.subheadline` |
| Caption | 13 / regular | `.footnote` |
| Metric | 24 / bold (rounded on iOS) | `.title2` |

Web uses SF Pro on Apple devices and Inter elsewhere.

## Components
| Component | Web (`apps/web/src/components/ui`) | iOS (`DesignSystem/Components`) |
|---|---|---|
| Button / secondary / link | `Button`, `ButtonLink` variants | `.hmPrimary`, `.hmSecondary`, `.hmLink` |
| Icon button | `IconButton` | `IconButton` |
| Card | `Card`, `CardHeader` | `.hmCard()`, `SectionHeader` |
| Icon badge | `IconBadge` | `IconBadge` |
| Metric card | `MetricCard` (+ count-up, heartbeat) | `MetricCard` (+ numeric transition, heartbeat) |
| AI insight card | `InsightCard` | `InsightCard` |
| Avatar | `Avatar` | `AvatarView` |
| Chart card | `ChartCard` | `ChartCard` |
| Task row | `TaskRow` | `TaskRow` + `CheckBox` |
| Medication row | `MedicationRow` | `MedicationRow` |
| Timeline item | `TimelineItem` | `TimelineItem` |
| Chat bubble | `ChatBubble` | `ChatBubble` |
| Input | `Input` | sign-in field builder |
| Search / ask bar | `SearchBar` | `AskBar` |
| Tabs | `Tabs` (WAI-ARIA, arrow keys) | `SegmentedTabs` (sliding indicator) |
| Bottom navigation | `BottomNav` (phones) | native `TabView` |
| Sidebar | `Sidebar`, `MobileNavDrawer` | — |
| Modal | `Modal` (native `<dialog>`) | native `.sheet` |
| Upload | `UploadDropzone` (type/size validation) | `UploadCard` |
| Report card | `ReportCard` | `ReportCard` |
| Status badge | `StatusBadge` | `StatusBadge` |
| Progress | `ProgressBar`, `ProgressRing` | `HMProgressBar`, `ProgressRing` |
| Mood selector | `MoodSelector` (radio group) | `MoodSelector` |
| Empty state | `EmptyState` | `EmptyStateView` |
| Celebration | `ConfettiBurst` | `CelebrationBurst` |
| Disclaimer / demo notice | `Disclaimer`, `SampleDataNotice` | `DisclaimerView`, `SampleDataBanner` |

iOS has a live catalogue at **Profile → Design system**.

## Motion
Soft springs and short fades: staggered fade-up entrances, mascot float/blink/wave, heartbeat on the
heart-rate icon, springy checkbox pop with haptics, count-up metrics, progress rings that sweep in,
a confetti burst when the day's plan is complete, press-scale on buttons and cards, sliding tab
indicator. All motion is disabled or reduced when the user prefers reduced motion.
