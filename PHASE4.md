# Phase 4 — Feel tuning pass & release demo

## Tuning review

- [ ] Drive every car on every track; note feel issues _(needs a human driving)_
- [ ] Fix one bad corner per track in `tuning.ts` _(needs a human driving)_
- [x] No no-op upgrade — `Economy.test.ts` asserts every tier of every slot
      changes at least one resolved stat.
- [x] No unfair par — `ParReward.test.ts` asserts the par bonus fires for a
      sub-par lap and that an autopilot laps every track within [0.7x, 1.6x]
      of par.
- [x] Racing the field pays — a podium bonus (`PODIUM_BONUS` in
      `economy.ts`), itemised on the results screen with the pace bonus.

## Performance

- [x] FPS counter in the HUD
- [x] Skid marks capped at 400 and object-pooled (`SkidMarks.test.ts`)
- [x] Profiled in Chromium. The JS side of a frame is ~0.5 ms; the cost is
      filling pixels (it bites under software rasterization). Fixes: ground
      baked into the pre-painted track art, vignette cached, opaque canvas.
      Headless software raster, before → after: 1920×1080 28 → 60 fps,
      1440×900 @2× 12 → 35, 844×390 @3× 21 → 60; output pixel-diffed as
      visually identical.
- [ ] Confirm 60fps on a real low-end laptop _(needs a device)_

## Input

- [x] Settings screen with key rebinding (persisted, applied live)
- [x] On-screen touch controls — multi-touch, slide between buttons, shown
      only on touch screens (`core/TouchInput.ts`)
- [x] Gamepad — analog steering + triggers, Start pauses (`core/Gamepad.ts`)
- [x] Pause menu (Esc / P / Start / ⏸) and auto-pause on focus loss
- [x] 3-2-1 start countdown holding the whole field

## Accessibility / Readability

- [x] Colorblind mode (`std` amber/blue ↔ `cb` orange/blue), also used for the
      ghost split's ahead/behind colours
- [x] HUD size option (sm/md/lg); the HUD also shrinks to fit narrow screens
- [x] Start button pinned in view on short screens; How to Play on first launch

## Packaging / Release

- [x] `npm run build` passes (CI also runs lint, format, tests, e2e)
- [x] Deploy workflow for GitHub Pages (`.github/workflows/deploy.yml`)
- [ ] Enable Pages in repo settings and merge to `main` → public URL
- [ ] Record 60-sec first-run video
- [ ] Put the public URL + video in the README

## Definition of Done

- Stable 60fps, deployed URL, 60-sec video.
