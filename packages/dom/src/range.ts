import { findCssSelector } from './css-selector';

function getNodeIndex(node: Node): number {
  let count = 0;

  while ((node = node.previousSibling!)) {
    count += 1;
  }

  return count;
}

export function encodeRange(range: Range | Selection): string {
  if (range instanceof Selection) range = range.getRangeAt(0);

  const startSelector = findCssSelector(range.startContainer.parentElement!);
  const startContainerIndex = getNodeIndex(range.startContainer);
  const endSelector = findCssSelector(range.endContainer.parentElement!);
  const endContainerIndex = getNodeIndex(range.endContainer);
  return `::range(${startSelector}, ${startContainerIndex}, ${range.startOffset}, ${endSelector}, ${endContainerIndex}, ${range.endOffset})`;
}

function findContainer(selector: string, nodeIndex: number): Node {
  const element = document.querySelector(selector);

  if (element === null) throw new Error('Cant find element');

  let child = element.firstChild;

  while (child && nodeIndex > 0) {
    child = child.nextSibling;
    nodeIndex -= 1;
  }

  if (child === null) throw new Error(`Cant find child at index ${nodeIndex}`);

  return child;
}

const regex =
  /::range\((?<startSelector>.*), (?<startIndex>.*), (?<startOffset>.*), (?<endSelector>.*), (?<endIndex>.*), (?<endOffset>.*)\)/;

export function decodeRange(str: string): Range {
  const groups = regex.exec(str)?.groups;

  if (groups == null) throw new Error('Invalid range string.');

  let { startSelector, startIndex, startOffset, endSelector, endIndex, endOffset } = groups;

  const range = document.createRange();

  range.setStart(findContainer(startSelector, Number(startIndex)), Number(startOffset));

  range.setEnd(findContainer(endSelector, Number(endIndex)), Number(endOffset));
  return range;
}
