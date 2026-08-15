# Login visual QA

## Comparison target

- **Source visual truth:** `C:\Users\aaron\.codex\codex-remote-attachments\019f6520-eee3-7151-8cbe-5092fae9dcae\D64C20B4-63BB-46E2-9F27-31794383C4B2\1-Photo-1.jpg` (1255 × 1255 px).
- **Implementation capture:** `C:\Users\aaron\Documents\Codex\NexusMSP\design-qa-login.png` (1280 × 720 px), browser-rendered from `http://localhost:3000/login?preview=1&experience=classic`.
- **State:** desktop, default NexusMSP brand, local preview switcher visible, populated email/password fields, idle sign-in state.
- **Density normalisation:** source is a square brand artwork while the implementation is a 16:9 application screen. The supplied artwork is therefore intentionally cropped to its central Nexus monogram and globe; the remaining screen is evaluated as a sign-in product experience rather than a poster recreation.

## Full-view comparison

The implementation retains the supplied image as the only hero artwork and adopts its deep-space navy, electric cyan, cobalt and silver visual direction. It places the visual as a deliberately cropped, illuminated monogram in the product hero rather than stretching a square poster across the screen. The sign-in panel remains immediately legible and keeps the original working login hierarchy.

## Focused-region comparison

The hero region and sign-in card were inspected separately. The hero crop contains the Nexus monogram, orbital light trail and globe treatment without the source image's white outer canvas. The sign-in card remains visually distinct from the artwork, with clear labels, input boundaries, keyboard focus styling and a high-contrast primary action.

## Required fidelity surfaces

- **Fonts and typography:** The existing product type hierarchy is retained: a strong white display headline, cyan-to-blue accent line, compact uppercase security signal and readable form labels. Text wrapping remains controlled at the tested desktop width.
- **Spacing and layout rhythm:** The visual hero is contained within the left product story column; it does not overlap the headline or primary form. The form has a stable, familiar vertical rhythm and the sign-in control remains above the fold.
- **Colours and visual tokens:** The prior green-led sign-in treatment is now anchored in the source artwork's cyan/blue spectrum while green remains reserved for positive/live status semantics. Contrast between foreground content and the deep navy background remains adequate.
- **Image quality and asset fidelity:** The supplied raster is used directly as the hero asset. The crop avoids its white outer canvas and preserves the provided monogram, globe and orbital detail. No replacement logo or fabricated image asset was introduced.
- **Copy and content:** The hero now says “The MSP platform that runs the MSP.”, reinforcing the wording shown in the supplied mark while the sign-in guidance remains clear and operationally appropriate.

## Findings

No actionable P0, P1 or P2 findings remain at the tested desktop state.

### P3 follow-up polish

- Consider commissioning a transparent/vector version of the new Nexus mark for future use in constrained spaces such as favicons and tray icons. The supplied raster is effective for the login hero but is not a replacement for those small-format assets.

## Interaction and runtime checks

- Login email and password fields render and remain visible.
- Password visibility control is present.
- Local-account helper and experience preview selector render.
- Browser console errors: none observed.
- Motion respects `prefers-reduced-motion` through the existing login-wide motion override and the new hero selectors.

## Comparison history

1. Initial browser capture exposed too much of the supplied image's white outer background in the hero.
2. The image treatment was changed to a contained crop of the monogram/globe with a deep-space presentation.
3. The revised browser capture showed the intended logo treatment, no console errors, and no remaining actionable visual issue.

## Implementation checklist

- [x] Use the supplied Nexus logo art directly.
- [x] Apply matching cyan, cobalt, navy and silver styling to the login experience.
- [x] Preserve the working authentication form and sign-in states.
- [x] Add subtle motion with reduced-motion support.
- [x] Verify the browser-rendered login page and console.

final result: passed
