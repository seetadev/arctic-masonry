import { ArcticMasonry } from './arctic-masonry.js';

const response = await fetch('images.json');
if (!response.ok) throw new Error(`Could not load images.json (${response.status})`);
const images = await response.json();

// Small batches so scrolling (or the button) visibly loads more of the 16 demo images.
new ArcticMasonry(document.getElementById('main'), { images, batchSize: 6 });
