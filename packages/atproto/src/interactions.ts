import type {} from '@folkjs/labs/folk-shape-attribute';
import { selectElement } from '@folkjs/labs/interactions/dom-selection';
import { type ATRecord } from './at-record';
import { fetchBacklinks } from './utilities';

export async function atCards(container: HTMLElement, cancellationSignal: AbortSignal) {
  console.log('cards');
  const el = await selectElement<ATRecord>(cancellationSignal, container, (el) => el.closest('at-record'));

  if (el?.atUri == null || el.folkShape === undefined) return;

  // const collection = window.prompt('Collection (NSID)')
  // const field = window.prompt('Collection (NSID)')

  // if (collection === null || field === null) return;

  const collectionLinks = await fetchBacklinks(el.atUri, 'network.cosmik.collectionLink', 'collection.uri');

  const left = el.folkShape.right + 20;
  const top = el.folkShape.y;
  const cardHeight = 250;

  const cardRecords = collectionLinks.map((link, i) => {
    const el = document.createElement('at-record');
    el.atUri = link.value.card.uri;
    el.renderer = 'UI';
    el.setAttribute(
      'folk-shape',
      `x: ${left}; y: ${top + i * (cardHeight + 15)}; width: ${350}; height: ${cardHeight};`,
    );
    return el;
  });

  container.append(...cardRecords);
}
