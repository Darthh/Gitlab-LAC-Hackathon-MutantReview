# GitLab-style Front Desk

The user's GitLab dark-dashboard screenshot is the visual reference. The app keeps the Mutant Review name, existing page content, execution evidence and approval behavior.

The interface now uses the reference's `#050506` navigation, `#18171d` content surface, gray card borders, selected navigation rows, blue links and compact typography. Its application frame has a 46px global header, a 240px desktop sidebar, a centered search control and a bordered scrolling content area. Status labels retain distinct success, warning and failure colors.

The follow-up branding update uses the header's DNA mark as the shared app and README logo. Brand accents and the favicon use `#009777`, sampled from the previous emerald logo, in place of orange. The README includes matching SVG wordmarks for light and dark themes and screenshots of all six pages.

GitLab Sans and GitLab Mono are self-hosted from the official `@gitlab/fonts` 1.3.1 distribution, with the original font licenses included. The Google Fonts import was removed. Layout and palette changes cover Overview, Findings, Test changes, Verification, Work ledger, Footprint and the existing dialogs.

REA was used before and after the redesign:

```text
npx --yes rea-agents@6.7.0 analyze-javascript-application apps/front-desk --artifact-format directory --source-path src/App.tsx --source-path src/Footprint.tsx --source-path src/Protection.tsx --format json
```

REA parsed all three selected TSX sources without a parse failure. The final analysis visited 14,670 AST nodes and retained 109 evidence observations. These are static analysis observations, not 109 reported bugs. Thirteen other inventoried files were outside the selected analysis scope. Browser verification was performed separately; REA did not recover GitLab's private source or automatically clone its interface.

Validation completed:

- All 197 unit tests passed, and TypeScript plus the production Vite build passed.
- All six pages were checked at 1916px, 1280px and 375px widths. The scrolling application frame had no horizontal overflow in those checks.
- A computed-style text-contrast check found no failing rendered text against the applicable 4.5:1 normal-text or 3:1 large-text threshold. This is not a full accessibility certification.
- Search opened from the keyboard, filtered pages and navigated to the selected page; the project dialog opened and closed with Escape; narrow navigation and region selection worked.
- Local evidence, export links, charts, mutant counts and approval states were retained. Navigation resets the content frame to the top of its selected page.
- The browser reported no application console errors or warnings. Both GitLab font faces loaded locally.
- The repository pre-push mutation command was run and remained inconclusive: its demo-only test configuration has no related tests for the changed app code. No evaluator configuration or policy was changed.

Updated screenshots: [Overview](../images/front-desk-overview.png), [Findings](../images/front-desk-findings.png), [Test changes](../images/front-desk-protection.png), [Verification](../images/front-desk-verification.png), [Work ledger](../images/front-desk-ledger.png) and [Footprint](../images/front-desk-footprint.png).

References: [REA](https://github.com/morluto/rea), [GitLab type fundamentals](https://design.gitlab.com/product-foundations/type-fundamentals/) and [official GitLab fonts](https://gitlab-org.gitlab.io/frontend/fonts/).

The changes were verified locally. Live GitLab/Duo actions and a Cloud Run deployment were not exercised for this visual change.
