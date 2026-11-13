/**
 * Fixed ambient light layer. Glass has nothing to bend without it, so every
 * screen paints two or three large, soft blooms behind its content.
 */
export function AmbientBackground() {
  return (
    <div className="ambient-layer" aria-hidden>
      <div className="ambient-blob ambient-blob--moon" />
      <div className="ambient-blob ambient-blob--champagne" />
      <div className="ambient-blob ambient-blob--deep" />
    </div>
  );
}
