import type { LexValue } from '@atproto/lex-data';
import { AtUri, NSID, type DidString, type HandleString, type NsidString, type RecordKeyString } from '@atproto/syntax';
import { css, property, ReactiveElement, state, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { html, render, type TemplateResult } from 'lit-html';

async function resolveHandle(handle: string): Promise<string | null> {
  try {
    const url = new URL('https://slingshot.microcosm.blue/xrpc/com.atproto.identity');
    url.searchParams.set('handle', handle);

    const recordResponse = await fetch(url);

    if (!recordResponse.ok) {
      console.warn(`Failed to resolve handle:`, handle);
      return null;
    }

    const recordData = await recordResponse.json();
    return recordData.did || null;
  } catch (error) {
    console.error(handle, error);
    return null;
  }
}

// https://slingshot.microcosm.blue/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Ahdhoaan3xa3jiuq4fg4mefid&collection=app.bsky.feed.like&rkey=3lv4ouczo2b2a
async function fetchRecord<T>(atUri: AtUri): Promise<T | null> {
  try {
    const url = new URL('https://slingshot.microcosm.blue/xrpc/com.atproto.repo.getRecord');
    url.searchParams.set('repo', atUri.did);
    url.searchParams.set('collection', atUri.collection);
    url.searchParams.set('rkey', atUri.rkey);

    const recordResponse = await fetch(url);

    if (!recordResponse.ok) {
      console.warn(`Failed to fetch record:`, atUri);
      return null;
    }

    const recordData = await recordResponse.json();
    return recordData;
  } catch (error) {
    console.error(atUri, error);
    return null;
  }
}

type ATRecordRenderer = (record: LexValue) => TemplateResult;

function jsonRenderer(record: LexValue) {
  return html`
  <style>
    pre {
      margin: 0;
    }
  </style>
  <pre><code>${JSON.stringify(record, null, 2)}</code></code>
  `;
}

export class ATRecord extends ReactiveElement {
  static override tagName = 'at-record';

  static #renderers = new Map<NsidString, Map<string, ATRecordRenderer>>();

  static getRenderer(collection: NsidString, name: string): ATRecordRenderer {
    return this.#renderers.get(collection)?.get(name) || jsonRenderer;
  }

  static setRenderer(collection: NsidString, name: string, renderer: string) {
    let collectionMap = this.#renderers.get(collection);

    if (collectionMap === undefined) {
      collectionMap = new Map();
      this.#renderers.set(collection, collectionMap);
    }
  }

  static override styles = css`
    :host {
      display: block;
    }

    [part='record'] {
      height: 100%;
      width: 100%;
    }
  `;

  #uri: AtUri | null = null;
  #container = document.createElement('div');
  #renderer: ATRecordRenderer = jsonRenderer;

  /** Handle or DID
   *
   * [atproto Reference](https://atproto.com/specs/did)
   **/
  @property({ type: String, reflect: true }) repo: HandleString | DidString | '' = '';

  /** [NSID](https://atproto.com/specs/nsid) of Collection
   *
   * [atproto Reference](https://atproto.com/guides/glossary#collection) */
  @property({ type: String, reflect: true }) collection: NsidString | '' = '';

  /** Record Key
   *
   * [atproto Reference](https://atproto.com/specs/record-key) */
  @property({ type: String, reflect: true }) key: RecordKeyString = '';

  /** The name of the renderer */
  @property({ type: String, reflect: true }) renderer = '';

  @state() record: LexValue | null = null;

  /** Content ID, a cryptographic hash of the record
   *
   * [atproto Reference](https://atproto.com/guides/glossary#cid-content-id) */
  // @property({ type: String, reflect: true }) cid = '';

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    this.#container.part.add('record');
    root.appendChild(this.#container);

    return root;
  }

  protected override update(changedProperties: PropertyValues<this>): void {
    super.update(changedProperties);

    if (changedProperties.has('repo') || changedProperties.has('collection') || changedProperties.has('key')) {
      this.#uri = AtUri.make(this.repo, this.collection, this.key);
      this.#fetchRecord();
    }

    if (changedProperties.has('renderer')) {
      this.#renderer = this.collection === '' ? jsonRenderer : ATRecord.getRenderer(this.collection, this.renderer);
    }
    if (changedProperties.has('record')) {
      this.#render();
    }
  }

  async #fetchRecord() {
    this.record = null;

    if (this.#uri === null) return;

    this.record = await fetchRecord(this.#uri);
    console.log(this.record);
  }

  #render() {
    if (this.record === null) {
      this.#container.textContent = '';
      return;
    }
    console.log('render');
    render(this.#renderer(this.record), this.#container);
  }
}
