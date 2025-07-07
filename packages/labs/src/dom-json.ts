import type { ImmutableString } from '@automerge/automerge-repo';

// TODO: make this 1:1 correspondence with DOM node types
// TODO: don't couple to Automerge types

// /** node is an element. */
// readonly ELEMENT_NODE: 1;
// readonly ATTRIBUTE_NODE: 2;
// /** node is a Text node. */
// readonly TEXT_NODE: 3;
// /** node is a CDATASection node. */
// readonly CDATA_SECTION_NODE: 4;
// readonly ENTITY_REFERENCE_NODE: 5;
// readonly ENTITY_NODE: 6;
// /** node is a ProcessingInstruction node. */
// readonly PROCESSING_INSTRUCTION_NODE: 7;
// /** node is a Comment node. */
// readonly COMMENT_NODE: 8;
// /** node is a document. */
// readonly DOCUMENT_NODE: 9;
// /** node is a doctype. */
// readonly DOCUMENT_TYPE_NODE: 10;
// /** node is a DocumentFragment node. */
// readonly DOCUMENT_FRAGMENT_NODE: 11;
// readonly NOTATION_NODE: 12;

export interface DOMJText {
  nodeType: Node['TEXT_NODE'];
  textContent: string;
}
export interface DOMJComment {
  nodeType: Node['COMMENT_NODE'];
  textContent: string;
}
export interface DOMJElement {
  nodeType: Node['ELEMENT_NODE'];
  tagName: string;
  attributes: { [key: string]: ImmutableString };
  childNodes: DOMJNode[];
}
export type DOMJNode = DOMJText | DOMJComment | DOMJElement;
