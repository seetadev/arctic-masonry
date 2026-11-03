/**
 * Arctic Masonry: a small, dependency-free, responsive masonry layout (ES module).
 *
 *   import { ArcticMasonry } from './arctic-masonry.js';
 *   new ArcticMasonry(document.getElementById('main'), {
 *     images: [{ src: 'a.jpg', alt: 'A', width: 500, height: 750 }, ...],   // width/height give the aspect ratio
 *   });
 *
 * Options: images (required), batchSize (default 15), breakpoints ([[minWidthPx, columns], ...]).
 *
 * More images load when the bottom of the gallery scrolls into view, and a "Load more" button is always
 * available as a keyboard/screen-reader fallback.
 */

// [minimum container width in px, number of columns]; the last entry whose minimum fits wins.
export const DEFAULT_BREAKPOINTS = [
  [0, 1], [400, 2], [700, 3], [900, 4], [1100, 5],
  [1600, 6], [1950, 7], [2200, 8], [2400, 9], [2500, 10],
];

export function columnCountFor(width, breakpoints = DEFAULT_BREAKPOINTS) {
  let columns = breakpoints[0][1];
  for (const [min, count] of breakpoints) if (width >= min) columns = count;
  return columns;
}

// Vertical gap between tiles as a fraction of the column width (matches .arctic-block margin-top in the CSS).
const TILE_GAP = 0.025;

export class ArcticMasonry {
  #root; #columnsEl; #footer; #status; #button; #sentinel; #images; #batchSize; #breakpoints;
  #columns = []; #heights = []; #tiles = []; #count = 0; #columnCount = 0; #resizeObserver; #intersectionObserver;

  constructor(container, { images = [], batchSize = 15, breakpoints = DEFAULT_BREAKPOINTS } = {}) {
    if (!(container instanceof Element)) throw new TypeError('ArcticMasonry needs a container element');
    this.#root = container;
    this.#images = images;
    this.#batchSize = batchSize;
    this.#breakpoints = breakpoints;

    this.#root.classList.add('arctic');
    this.#columnsEl = document.createElement('div');
    this.#columnsEl.className = 'arctic-columns';
    this.#root.append(this.#columnsEl);

    this.#footer = document.createElement('div');
    this.#footer.className = 'arctic-footer';
    this.#status = document.createElement('p');
    this.#status.className = 'arctic-status';
    this.#status.setAttribute('role', 'status');   // announces "Showing x of y" politely
    this.#status.tabIndex = -1;                    // receives focus when the button disappears
    this.#button = document.createElement('button');
    this.#button.type = 'button';
    this.#button.className = 'arctic-more';
    this.#button.textContent = 'Load more';
    this.#button.addEventListener('click', () => this.loadMore());
    this.#sentinel = document.createElement('div');
    this.#sentinel.className = 'arctic-sentinel';
    this.#footer.append(this.#status, this.#button, this.#sentinel);
    this.#root.append(this.#footer);

    this.#layout(columnCountFor(this.#root.clientWidth, this.#breakpoints));
    this.loadMore();
    requestAnimationFrame(() => this.#columnsEl.classList.add('is-ready'));

    this.#resizeObserver = new ResizeObserver(() => {
      const next = columnCountFor(this.#root.clientWidth, this.#breakpoints);
      if (next !== this.#columnCount) this.#layout(next);
    });
    this.#resizeObserver.observe(this.#root);

    // Scroll-triggered loading: when the sentinel (bottom of the gallery) comes into view, load a batch.
    this.#intersectionObserver = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && this.hasMore) {
        this.loadMore();
        // Still in view (short page / big batch)? Re-observe so we get another callback.
        this.#intersectionObserver.unobserve(this.#sentinel);
        this.#intersectionObserver.observe(this.#sentinel);
      }
    }, { rootMargin: '300px 0px' });
    this.#intersectionObserver.observe(this.#sentinel);
  }

  get columnCount() { return this.#columnCount; }
  get loadedCount() { return this.#count; }
  get totalCount() { return this.#images.length; }
  get hasMore() { return this.#count < this.#images.length; }

  /** Adds the next batch of images. Returns how many were added. */
  loadMore() {
    const end = Math.min(this.#count + this.#batchSize, this.#images.length);
    const added = end - this.#count;
    for (; this.#count < end; this.#count++) {
      const tile = this.#createTile(this.#images[this.#count]);
      this.#tiles.push(tile);
      this.#place(tile);
    }
    this.#publish();
    return added;
  }

  destroy() {
    this.#resizeObserver.disconnect();
    this.#intersectionObserver.disconnect();
    this.#columnsEl.remove();
    this.#footer.remove();
    this.#root.classList.remove('arctic');
    delete this.#root.dataset.columns; delete this.#root.dataset.loaded; delete this.#root.dataset.total;
  }

  #createTile({ src, alt = '', width, height }) {
    const block = document.createElement('div');
    block.className = 'arctic-block';
    const ratio = width && height ? height / width : 0.75;   // height / width; 4:3 landscape if unknown
    block.dataset.ratio = String(ratio);
    block.style.aspectRatio = `1 / ${ratio}`;
    const img = document.createElement('img');
    img.alt = alt;
    img.decoding = 'async';
    img.addEventListener('load', () => block.classList.add('is-loaded'));
    img.addEventListener('error', () => block.classList.add('is-error'));
    img.src = src;
    block.append(img);
    return block;
  }

  // Shortest-column placement: each tile goes to the column that is currently shortest (lowest index on
  // ties). Heights are tracked in units of the column width, from each tile's aspect ratio, so this
  // works before the images have loaded.
  #place(tile) {
    let shortest = 0;
    for (let i = 1; i < this.#heights.length; i++) if (this.#heights[i] < this.#heights[shortest]) shortest = i;
    this.#columns[shortest].append(tile);
    this.#heights[shortest] += Number(tile.dataset.ratio) + TILE_GAP;
  }

  #layout(columnCount) {
    this.#columnCount = columnCount;
    this.#columnsEl.replaceChildren();
    this.#columns = Array.from({ length: columnCount }, () => {
      const column = document.createElement('div');
      column.className = 'arctic-column';
      this.#columnsEl.append(column);
      return column;
    });
    this.#heights = new Array(columnCount).fill(0);
    this.#tiles.forEach((tile) => this.#place(tile));
    this.#publish();
  }

  #publish() {
    this.#status.textContent = `Showing ${this.#count} of ${this.#images.length} images`;
    const hadFocus = document.activeElement === this.#button;
    this.#button.hidden = !this.hasMore;
    if (hadFocus && !this.hasMore) this.#status.focus();   // don't drop keyboard focus onto <body>
    this.#root.dataset.columns = String(this.#columnCount);
    this.#root.dataset.loaded = String(this.#count);
    this.#root.dataset.total = String(this.#images.length);
  }
}
