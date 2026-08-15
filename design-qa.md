# Login visual QA

## Comparison target

- **Source visual truth:** `C:\Users\aaron\.codex\codex-remote-attachments\019f6520-eee3-7151-8cbe-5092fae9dcae\D64C20B4-63BB-46E2-9F27-31794383C4B2\1-Photo-1.jpg` (the user-supplied Nexus MSP visual direction).
- **Refined brand artwork:** `frontend/public/brand/nexus-login-beacon.png`, generated from the supplied image to preserve its metallic Nexus monogram, globe and cyan orbital language while removing the source image's white poster background and excess copy.
- **Implementation capture:** `C:\Users\aaron\Documents\Codex\NexusMSP\design-qa-login.png`, browser-rendered from `http://localhost:3000/login?preview=1&experience=classic` at 1280 × 720 CSS pixels.
- **State:** desktop, default NexusMSP brand, idle sign-in state with blank inputs.

## Full-view comparison

The first implementation treated the original square artwork as a left-side hero. That made the logo compete with the authentication task and exposed the original white canvas. The refined implementation uses a clean dark asset and one centred sign-in composition: the Nexus beacon leads the card, the dark network field supplies depth, and the form stays visually dominant.

## Focused-region comparison

The top brand region was compared with the supplied artwork's core traits: angular silver/black N, cyan energy trail and globe/network context. The refined asset retains those visual traits with a seamless deep-space background. The sign-in region was checked separately for legible labels, visible input boundaries, primary-action contrast and above-the-fold completion.

## Required fidelity surfaces

- **Fonts and typography:** Product typography remains restrained and readable. The brand image carries the expressive identity; operational copy remains calm and easy to scan.
- **Spacing and layout rhythm:** The entire authentication card fits at the tested 720 px viewport. The logo, security statement, form controls and assurance line have one clear vertical path.
- **Colours and visual tokens:** Deep navy/near-black, cyan and cobalt are taken directly from the supplied visual. Green remains reserved for positive security status instead of competing with the brand palette.
- **Image quality and asset fidelity:** The supplied artwork informed the generated dark beacon asset; no white canvas, poster border or improvised logo drawing remains. The visual is a real raster asset rather than CSS-drawn branding.
- **Copy and content:** The familiar sign-in wording is retained, with no marketing blocks competing with the task.

## Findings

No actionable P0, P1 or P2 findings remain in the tested desktop state.

### P3 follow-up polish

- Produce an approved transparent/vector master of the Nexus monogram before using this new visual in favicons, tray icons or print assets.

## Interaction and runtime checks

- Email, password, password-visibility control and sign-in action render visibly.
- The local-account helper remains available in local development.
- Browser console errors: none observed.
- The existing reduced-motion override covers the new beacon animation.

## Comparison history

1. Initial left-column crop was visually busy and retained the source image's white outer canvas.
2. A clean dark brand asset was created from the supplied visual direction.
3. The login was simplified to one centred sign-in card with a single animated brand beacon.
4. The form padding and header spacing were tightened so the full sign-in flow fits at 1280 × 720.

## Implementation checklist

- [x] Preserve the supplied Nexus logo's central visual language.
- [x] Remove the busy split-screen hero layout for the default Nexus brand.
- [x] Centre the brand and sign-in experience.
- [x] Keep motion subtle and reduced-motion safe.
- [x] Verify the rendered login and browser console.

final result: passed
