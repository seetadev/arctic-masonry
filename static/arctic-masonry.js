/**
 * Arctic Masonry: a small, dependency-free, responsive masonry layout (ES module).
 *
 *   import { ArcticMasonry } from './arctic-masonry.js';
 *   new ArcticMasonry(document.getElementById('main'), {
 *     images: [{ src: 'a.jpg', alt: 'A', width: 500, height: 750 }, ...],   // width/height give the aspect ratio
 *   });
 *
 * Options: images (required), batchSize (default 15), breakpoints ([[minWidthPx, columns], ...]).
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

export class ArcticMasonry {
  #root; #columnsEl; #images; #batchSize; #breakpoints;
  #columns = []; #tiles = []; #count = 0; #columnCount = 0; #resizeObserver;

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

    this.#layout(columnCountFor(this.#root.clientWidth, this.#breakpoints));
    this.loadMore();
    requestAnimationFrame(() => this.#columnsEl.classList.add('is-ready'));

    this.#resizeObserver = new ResizeObserver(() => {
      const next = columnCountFor(this.#root.clientWidth, this.#breakpoints);
      if (next !== this.#columnCount) this.#layout(next);
    });
    this.#resizeObserver.observe(this.#root);
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
      this.#place(tile, this.#tiles.length - 1);
    }
    this.#publish();
    return added;
  }

  destroy() {
    this.#resizeObserver.disconnect();
    this.#columnsEl.remove();
    this.#root.classList.remove('arctic');
    delete this.#root.dataset.columns; delete this.#root.dataset.loaded; delete this.#root.dataset.total;
  }

  #createTile({ src, alt = '', width, height }) {
    const block = document.createElement('div');
    block.className = 'arctic-block';
    if (width && height) block.style.aspectRatio = `${width} / ${height}`;
    const img = document.createElement('img');
    img.alt = alt;
    img.decoding = 'async';
    img.addEventListener('load', () => block.classList.add('is-loaded'));
    img.addEventListener('error', () => block.classList.add('is-error'));
    img.src = src;
    block.append(img);
    return block;
  }

  // Round-robin placement: tile i goes to column i % columnCount.
  #place(tile, index) {
    this.#columns[index % this.#columnCount].append(tile);
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
    this.#tiles.forEach((tile, i) => this.#place(tile, i));
    this.#publish();
  }

  #publish() {
    this.#root.dataset.columns = String(this.#columnCount);
    this.#root.dataset.loaded = String(this.#count);
    this.#root.dataset.total = String(this.#images.length);
  }
}
