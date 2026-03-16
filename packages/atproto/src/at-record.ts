import {
  AtUri,
  isValidDid,
  isValidHandle,
  type AtUriString,
  type DidString,
  type HandleString,
  type NsidString,
  type RecordKeyString,
} from '@atproto/syntax';
import { css, property, ReactiveElement, state, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { html, render, type TemplateResult } from 'lit-html';

const didCache = new Map<HandleString, DidString>();

async function resolveDidFromHandle(handle: HandleString): Promise<DidString | null> {
  const did = didCache.get(handle);
  if (did !== undefined) return did;

  try {
    const url = new URL('https://slingshot.microcosm.blue/xrpc/com.atproto.identity.resolveHandle');
    url.searchParams.set('handle', handle);

    const response = await fetch(url);

    if (!response.ok) {
      console.warn(`Failed to resolve handle:`, handle);
      return null;
    }

    const { did } = await response.json();
    if (isValidDid(did)) {
      didCache.set(handle, did);
      return did;
    }
    return null;
  } catch (error) {
    console.error(handle, error);
    return null;
  }
}

const recordCache = new Map<AtUriString, AnyATRecord>();

// https://slingshot.microcosm.blue/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Ahdhoaan3xa3jiuq4fg4mefid&collection=app.bsky.feed.like&rkey=3lv4ouczo2b2a
async function fetchRecord<AnyATRecord>(atUri: AtUri): Promise<AnyATRecord | null> {
  try {
    const uriString = atUri.toString();
    const record = recordCache.get(uriString);
    if (record !== undefined) return record as AnyATRecord;

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

    recordCache.set(uriString, recordData);
    return recordData;
  } catch (error) {
    console.error(atUri, error);
    return null;
  }
}

type AnyATRecord = {
  cid: string;
  uri: AtUriString;
  value: any;
};

type ATRecordRenderer = (record: AnyATRecord) => TemplateResult;

function jsonRenderer(record: AnyATRecord) {
  return html`
    <style>
      pre {
        font-size: 0.75rem;
        margin: 0;
      }
    </style>
    <pre><code>${JSON.stringify(record, null, 2)}</code></pre>
  `;
}

export class ATRecord extends ReactiveElement {
  static override tagName = 'at-record';

  static #renderers = new Map<NsidString, Map<string, ATRecordRenderer>>();

  static getRenderer(collection: NsidString, name: string): ATRecordRenderer {
    return this.#renderers.get(collection)?.get(name) || jsonRenderer;
  }

  static setRenderer(collection: NsidString, name: string, renderer: ATRecordRenderer) {
    let collectionMap = this.#renderers.get(collection);

    if (collectionMap === undefined) {
      collectionMap = new Map();
      this.#renderers.set(collection, collectionMap);
    }

    collectionMap.set(name, renderer);
  }

  static getRendererOptions(collection: NsidString): readonly string[] {
    const options = Array.from(this.#renderers.get(collection)?.keys() || []);
    // JSON is the default renderer
    if (!options.includes('json')) options.unshift('json');

    return options;
  }

  static override styles = css`
    :host {
      display: block;
      background: white
      position: relative;
      border: 2px black solid;
      border-radius: 5px;
      overflow: visible !important;
      padding: 0.25rem;
    }

    select {
      position: absolute;
      bottom: calc(100% + 2px);
      right: 5px;
      border-radius: 0;
    }

    [part='record'] {
      overflow: scroll;
      height: 100%;
      width: 100%;
    }
  `;

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

  @state() record: AnyATRecord | null = null;

  /** Content ID, a cryptographic hash of the record
   *
   * [atproto Reference](https://atproto.com/guides/glossary#cid-content-id) */
  // @property({ type: String, reflect: true }) cid = '';

  #select = document.createElement('select');
  #container = document.createElement('div');
  #renderer: ATRecordRenderer = jsonRenderer;

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    this.#select.part.add('select');
    this.#select.addEventListener('input', () => {
      this.renderer = this.#select.value;
    });
    this.#container.part.add('record');

    root.append(this.#select, this.#container);

    return root;
  }

  protected override update(changedProperties: PropertyValues<this>): void {
    super.update(changedProperties);

    if (changedProperties.has('repo') || changedProperties.has('collection') || changedProperties.has('key')) {
      this.#fetchRecord();
    }

    if (changedProperties.has('collection') && this.collection) {
      const options = ATRecord.getRendererOptions(this.collection).map(
        (name) => `<option value="${name}" ${this.renderer === name ? 'selected' : ''}>${name}</option>`,
      );
      this.#select.setHTMLUnsafe(options.join(''));
    }

    if (changedProperties.has('renderer')) {
      this.#renderer = this.collection === '' ? jsonRenderer : ATRecord.getRenderer(this.collection, this.renderer);
      this.#render();
    }

    if (changedProperties.has('record')) {
      this.#render();
    }
  }

  async #fetchRecord() {
    this.record = null;

    let didOrHandle = this.repo;
    if (isValidHandle(didOrHandle)) {
      didOrHandle = (await resolveDidFromHandle(didOrHandle)) || this.repo;
    }
    const uri = AtUri.make(didOrHandle, this.collection, this.key);

    this.record = await fetchRecord(uri);
  }

  #render() {
    if (this.record === null) {
      this.#container.textContent = '';
      return;
    }
    render(this.#renderer(this.record), this.#container);
  }
}

/* {
  "cid": "bafyreihh2l5iqxreqymqj7wribrochcgjkcmsichfdscww2j63i2j6dz5q",
  "uri": "at://did:plc:zcanytzlaumjwgaopolw6wes/network.cosmik.collection/3mfrzrpx6fw26",
  "value": {
    "$type": "network.cosmik.collection",
    "accessType": "OPEN",
    "collaborators": [],
    "createdAt": "2026-02-26T20:26:25.872Z",
    "description": "Collectively-sourced, weather reports of the atmosphere.",
    "name": "at://news",
    "updatedAt": "2026-03-02T22:24:05.268Z"
  }
} */
ATRecord.setRenderer(
  'network.cosmik.collection',
  'UI',
  ({ value }: AnyATRecord) => html`
    <style>
      [part='record'] {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem, 1rem;

        > * {
          margin: 0;
        }
      }

      p {
        font-size: 0.75rem;
      }

      p:last-child {
        width: 100%;
      }
    </style>

    <h2>${value.name}</h2>
    <p>${value.accessType} | ${new Date(value.createdAt).toLocaleDateString()}</p>
    <p>${value.description}</p>
  `,
);

ATRecord.setRenderer('network.cosmik.card', 'UI', (record: AnyATRecord) => html`<h1>Hello World</h1>`);
