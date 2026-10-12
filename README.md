# AIPERION website

A bilingual, static Jekyll website for Christoph Hofmann's AI engineering,
architecture, development and coaching work. Production source lives in `docs/`.
It uses HTML, Liquid, CSS and a small progressive-enhancement navigation script,
not a client-side application framework.

## Local setup

Use Ruby **3.3** on your `PATH` (the locked dependencies require at least Ruby
3.2), Bundler **2.4.19**, Python **3.9+** and Node.js **18+**. Node supplies
JavaScript syntax checks and the optional browser regression runner; Python
supplies the built-site tests and an optional local HTTP server. Do not use
macOS's system Ruby.

From the repository root, keep all installed gems and build artifacts local:

```sh
mkdir -p .website-build/gems .website-build/work
export GEM_HOME="$PWD/.website-build/gems"
export GEM_PATH="$GEM_HOME:$(ruby -e 'puts Gem.default_dir')"
export PATH="$GEM_HOME/bin:$PATH"
export TMPDIR="$PWD/.website-build/work"
export BUNDLE_GEMFILE="$PWD/docs/Gemfile"
export BUNDLE_PATH="$PWD/.website-build/bundle"
export BUNDLE_APP_CONFIG="$PWD/.website-build/bundle-config"
export BUNDLE_CACHE_PATH="$PWD/.website-build/gem-cache"

gem install bundler --version 2.4.19 --no-document
bundle _2.4.19_ install
```

The lockfile pins Jekyll 3.10.0 and `github-pages` 232. Its Linux, Windows and
Apple Silicon macOS platforms use the same dependency versions. Preserve the
lockfile; do not run an unrequested dependency update.

## Build, test and serve

In the same shell as setup:

```sh
BUNDLE_FROZEN=true JEKYLL_ENV=production bundle _2.4.19_ exec jekyll build \
  --source docs --destination _site
node --check docs/assets/js/navigation.js
python3 tests/test_site.py --site _site
git diff --check

python3 -m http.server 4000 --bind 127.0.0.1 --directory _site
```

Open <http://127.0.0.1:4000/>. Stop the server with Ctrl+C. The Python server
serves the built files without rebuilding; rebuild after editing. GitHub Pages
uses `404.html` as its custom not-found response; the simple Python server only
shows that document when you request `/404.html` directly.

The explicit test-bar commands in `.github/solution-profile.yaml` run from the
repository root after restoring the setup environment. The lint slot checks
JavaScript syntax, not ESLint; the typecheck slot compiles Jekyll with the frozen
bundle; the unit-test slot runs the fast built-site regressions without an
external backend. The compile command uses the POSIX `env` utility (macOS/Linux,
or a compatible environment on Windows). Smoke serves `_site` on loopback port
4000. If that port is occupied, supply the gate's `SmokeCommand` and `SmokeUrl`
overrides with the same free port. These checks do not deploy the website.

Verify project-site paths without changing production configuration:

```sh
BUNDLE_FROZEN=true JEKYLL_ENV=production bundle _2.4.19_ exec jekyll build \
  --source docs --destination .website-build/baseurl-site --baseurl /site-check
python3 tests/test_site.py --site .website-build/baseurl-site --baseurl /site-check
```

The standard-library regression suite checks all four routes, language and
section destinations, canonical/hreflang/social metadata, the approved content
and counts, client-story qualifications, date-free credentials, compact project
entries, contact/source links, image alternatives, licensed asset integrity and
production-output exclusions. It does not contact third-party destinations.
Fixtures contain approved public copy, not private design notes. A fixture
change needs an explicit content decision, not merely a failing test.

For visual changes, also exercise all four built HTTP routes in a real browser
at 320, 390, 768, 1024, 1199, 1200 and 1440 CSS pixels. Check keyboard/skip-link
focus, Escape, short-viewport menu scrolling, both language directions with a
section or project anchor, reduced motion, no-JavaScript content and zoom/reflow.
Do not treat a static HTML check or local browser timing as field performance
evidence.

The focused browser suite uses an **already available** Playwright core module
and Chromium-based browser, with no website/frontend dependency or tool
installation. With the built site served locally, run:

```sh
SITE_URL=http://127.0.0.1:4000/ \
PLAYWRIGHT_MODULE=/path/to/playwright-core \
BROWSER_EXECUTABLE=/path/to/browser \
EVIDENCE_DIR=.website-build/motion-footer/root \
node tests/test_interactions.cjs
```

It checks all four routes at the widths above, intrinsic header SVG fill
with CSS disabled, logo geometry, the minimal footer, keyboard/anchor/language navigation,
short-menu resizing, actual entrance/menu/button motion, one-time supporting
image entrances, live reduced-motion cancellation and no-JavaScript/unsupported
animation-API behavior. It samples the rendered glass background over images
and light sections for contrast. It also checks reduced transparency when the
browser exposes that media feature, and simulates a nonmatching backdrop-filter
`@supports` rule to exercise the solid fallback. Reports, screenshots and failure
traces stay under the chosen project-relative evidence directory. Each run uses
an isolated browser profile and removes its own profile/runtime on exit.
For base-path verification, serve a directory containing the built `site-check/`
folder and set `SITE_URL` to `http://127.0.0.1:PORT/site-check/`.

## Routes and content editing

| Route | Source | Shared layout |
| --- | --- | --- |
| `/` | `docs/index.html` | `home` |
| `/de/` | `docs/de/index.html` | `home` |
| `/projects/` | `docs/projects/index.html` | `projects` |
| `/de/projects/` | `docs/de/projects/index.html` | `projects` |

- **Copy and labels:** `docs/_data/locales/en.yml` and `de.yml`. Keep both
  languages complete; German uses formal *Sie*. Titles/descriptions live under
  `metadata`. Selected technologies include both explanations and category lists.
- **Page composition:** `docs/_layouts/` and `docs/_includes/sections/`.
  Header, footer, language switch, metadata and image markup are shared.
  Prose fields in biography/context and technology items permit the existing
  `<strong>`/`<span>` emphasis; ordinary labels and descriptions are escaped.
- **Public software projects:** add one real, approved entry to
  `docs/_data/projects.yml`, with a stable `id`, name, repository/README/license
  URLs, and `en`/`de` category, license label and short summary. Both listings
  render the same entries. Keep summaries under 60 words; long documentation
  belongs in the linked README. Do not add placeholders, filters or pagination.
- **Credentials:** `docs/_data/credentials.yml` contains exact selected names
  and verification links. Do not add earned, expiry, validity or renewal dates.
  Planned AI certification stays separate in localized copy.
- **Shared identity/contact:** `docs/_config.yml`. Language names, canonical
  route pairs and Open Graph locales are in `docs/_data/languages.yml`.
- **Presentation/behavior:** `docs/assets/css/style.css` and
  `docs/assets/js/navigation.js`. The menu collapses below 1200px, the hero
  below 1024px, and other content below 768px.

Preserve `#services`, `#work`, `#approach`, `#tech`, `#about` and `#contact`.
Language links retain recognized matching anchors when JavaScript is available.
Without JavaScript, all content and navigation remain available; language links
open the matching document at its beginning. There is no automatic locale
redirect, preference storage, analytics, embedded social feed or form backend.
Use Jekyll's `relative_url` and `absolute_url` filters for new local links/assets.

### Motion and navigation

The accepted layout, copy, palette and images stay unchanged. A native CSS
entrance brings the hero copy/image or project heading/intro into place over
520ms with an 8px movement and a 60ms stagger. Content starts visible even
without JavaScript. Controls use 180ms feedback; the mobile menu has a brief
4px entrance. Only the two supporting concept images (`.service-media` and
`.workflow-media`) have an additional one-time entrance when they enter the
viewport: 560ms, 10px, from 88% to full opacity. Native `IntersectionObserver`
and Web Animations leave normal styles in place before and after the effect.
Images stay fully visible without JavaScript or either API; scrolling back
does not replay them. Text and sections do not reveal on scroll. There are no
continuous animations, parallax, smooth-scroll overrides or animation libraries.

The navigation uses the existing dark scene color at 85% opacity, a bounded
16px backdrop blur and a subtle inset border. The solid scene color is the
fallback when blur is unavailable and when a supported
`prefers-reduced-transparency: reduce` preference is active.
`prefers-reduced-motion: reduce` removes all animations/transitions and
interaction transforms, leaving their static final states.
Supporting-image motion also responds to preference changes: enabling reduced
motion cancels any active image entrance immediately, without replaying viewed
images if the preference is later reversed.

The enhanced header is fixed to the viewport: only the page content and footer
move during document scrolling, without a separate nested page scroller.
The navigation script enables this when `ResizeObserver` can measure the actual
header. Its collapsed row height reserves space above the content, without
shifting the page when the mobile menu opens. Root scroll padding tracks the
full visible header height; anchor/focus margins leave clearance below it.
Initial deep links, same-page section selection and keyboard focus are handled
without smooth scrolling. The mobile menu fits the remaining viewport, stays
scrollable after resizing, and closes when focus leaves the header. Without
JavaScript (or without `ResizeObserver`), the header remains in normal flow,
with no extra content offset.

## Assets and publication boundaries

Newsreader and Manrope are self-hosted, byte-identical approved variable TTFs in
`docs/assets/fonts/`, alongside their full SIL Open Font License texts. No fonts
are fetched from an external service. The six WebP derivatives in
`docs/assets/images/` supply three concept illustrations; they are not client
evidence and have localized alternatives, not visible captions. Do not publish
original masters, export tooling, design provenance or private configuration.

The original `docs/assets/images/logo.svg` is unchanged. The shared inline
partial, `docs/_includes/logo.svg`, preserves its geometry and lets the wordmark
extend beyond the original viewBox without clipping. The header keeps its original
`#F0F4FF` wordmark, blue/cyan mark and gradient, responsive `.brand` sizing and
localized home link.

The footer contains only **Impressum** and the English/Deutsch language picker,
without a logo, author line or additional navigation. Its language link opens
the matching localized page and preserves recognized section anchors with
JavaScript. Until approved legal content or a destination URL is supplied,
Impressum is deliberately non-clickable text, not a broken or placeholder link.
It must be connected to the reviewed legal notice before publication.
Biography, metadata and contact identities are unchanged. These website
refinements supersede the older Penpot/static preview footer and motion states;
those design artifacts have not been regenerated.

### Social platform logos and embedding

Profile links retain their English/German labels and use local, unmodified
platform assets rather than icon-font approximations or externally hosted images:

- `docs/assets/images/linkedin-in.png`: `in-logo/LI-In-Bug.png` from the
  [official LinkedIn downloads](https://brand.linkedin.com/downloads), preserving
  the supplied color, proportions and registration mark. Use is subject to
  [LinkedIn's brand policies](https://brand.linkedin.com/policies).
- `docs/assets/images/medium-symbol.svg`: the black symbol supplied in
  [Medium's official logo kit](https://github.com/Medium/medium-logos/blob/cd9acd1fff7e3c902b559de6c808c4a491f2d160/03_Symbol/01_Black/SVG/Medium_Symbol_NoPadding.svg).
  The kit's [usage guidance](https://github.com/Medium/medium-logos/blob/cd9acd1fff7e3c902b559de6c808c4a491f2d160/README.md)
  permits web use without alteration, brand confusion or implied endorsement.

The logos appear beside the biography links and the LinkedIn contact link.
They keep their aspect ratios and have empty image alternatives because the
adjacent visible labels already name the links. Asset hashes are covered by the
regression suite; the three concept images remain a separate content contract.

LinkedIn also hosts a [public-profile badge script](https://platform.linkedin.com/badges/js/profile.js);
using that widget would add external code and content requests. Medium documents
[RSS feeds for showing your own latest stories](https://help.medium.com/hc/en-us/articles/214874118-Using-RSS-feeds-of-profiles-publications-and-topics),
which could support a separately requested feed integration. Neither is enabled:
the site keeps ordinary profile links, with no social widget, iframe or new
third-party requests before a visitor follows a link.

Client work is deliberately anonymous: two healthcare examples and one
automotive **prototype**. Preserve the clinical-scope and intended-benefit
limits; add no client identities, measured results, safety claims or rollout
claims. Only the approved 10+ years and 50+ projects figures are displayed.
The starter Jekyll post is retained in source but excluded from publication.

**Before publication:** supply and review the required Impressum and privacy
content against actual business and data-processing facts. No legal facts,
placeholder routes or dead legal links have been invented. The existing
`.github/workflows/jekyll-gh-pages.yml` builds `docs/` and deploys on `main`
pushes or manual dispatch; do not use that deployment workflow for local testing.
