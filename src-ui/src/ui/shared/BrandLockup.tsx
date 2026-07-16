// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

// Brand lockup — the hand-brushed "FicForge" wordmark, written in one
// calligraphic hand, whose capital F carries the app icon's ribbon-and-brush.
//
// Where it belongs: big brand moments only (splash, onboarding welcome). UI
// chrome (Library topbar, workspace sidebar) deliberately uses the plain
// EB Garamond wordmark instead — at ~30px this script turns fussy and fights
// the crisp icons around it.
//
// Rendered as a CSS mask filled with the theme `text` colour, so it adapts to
// light/dark automatically instead of shipping two raster variants. Carries an
// aria-label because it stands in for real wordmark text.
//
// Aspect ratio is ~2.31 (w/h) — size it with a matching w/h pair or it will
// letterbox inside its box. Swap `public/wordmark.png` to update every usage.
const LOCKUP_STYLE: React.CSSProperties = {
  WebkitMaskImage: "url(/wordmark.png)",
  maskImage: "url(/wordmark.png)",
  WebkitMaskSize: "contain",
  maskSize: "contain",
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskPosition: "center",
  maskPosition: "center",
};

export function BrandLockup({ className }: { className?: string }) {
  return <span role="img" aria-label="FicForge" className={`block bg-text ${className ?? ""}`} style={LOCKUP_STYLE} />;
}
