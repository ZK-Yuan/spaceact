const COLS = 7, ROWS = 5;

/** Sizes the hero wall (a 7 x 5 grid of task tiles, 3:2 cells) so it covers the screen. */
export function createWall(root) {
  const wall = root.querySelector(".wall");
  function layout() {
    const tw = Math.max(root.clientWidth / COLS, (root.clientHeight / ROWS) * 1.5);
    wall.style.width = `${tw * COLS}px`;
    wall.style.height = `${(tw / 1.5) * ROWS}px`;
  }
  layout();
  window.addEventListener("resize", layout);
}
