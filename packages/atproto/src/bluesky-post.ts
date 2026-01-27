import { css, property, ReactiveElement, type PropertyValues } from '@folkjs/dom/ReactiveElement';

const AT = 'at://';
const EMBED_URL = 'https://embed.bsky.app';

// <blockquote class="bluesky-embed" data-bluesky-uri="at://did:plc:zcanytzlaumjwgaopolw6wes/app.bsky.feed.post/3mbp3x7tcnc2y" data-bluesky-cid="bafyreicgymqethsvhvhveyafjvzb3vaajd7ilrmxuvm7wfsxmupom7yta4" data-bluesky-embed-color-mode="system"><p lang="en">Embedding bluesky posts via embed.bsky.app/static/embed... is unnecessarily more complicated than it needs to be, gonna simplify it.<br><br><a href="https://bsky.app/profile/did:plc:zcanytzlaumjwgaopolw6wes/post/3mbp3x7tcnc2y?ref_src=embed">[image or embed]</a></p>&mdash; 𝕮 (<a href="https://bsky.app/profile/did:plc:zcanytzlaumjwgaopolw6wes?ref_src=embed">@chrisshank.com</a>) <a href="https://bsky.app/profile/did:plc:zcanytzlaumjwgaopolw6wes/post/3mbp3x7tcnc2y?ref_src=embed">January 5, 2026 at 10:46 AM</a></blockquote><script async src="https://embed.bsky.app/static/embed.js" charset="utf-8"></script>
export type Theme = 'system' | 'light' | 'dark';

export class BlueskyPost extends ReactiveElement {
  static override tagName = 'bluesky-post';

  static override styles = css`
    :host {
      display: block;
      max-width: 600px;
      box-sizing: border-box;
      padding: 5px;
    }

    iframe {
      display: block;
      width: 100%;
      border: none;
    }
  `;

  @property({ type: String, reflect: true }) uri = '';

  @property({ type: String, reflect: true }) cid = '';

  @property({ type: String, reflect: true }) theme: Theme = 'system';

  #postId = '';

  #iframe = document.createElement('iframe');

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    root.appendChild(this.#iframe);

    return root;
  }

  override connectedCallback(): void {
    super.connectedCallback();

    window.addEventListener('message', this.#onMessage);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();

    window.removeEventListener('message', this.#onMessage);
  }

  protected override update(changedProperties: PropertyValues): void {
    super.update(changedProperties);

    if (this.uri === '' || this.cid === '') {
      this.#iframe.src = '';
    } else {
      const uri = this.uri.startsWith(AT) ? this.uri.slice(AT.length) : this.uri;
      const url = new URL(EMBED_URL + '/embed/' + uri);

      this.#postId = Math.random().toString().slice(2);
      url.searchParams.set('id', this.#postId);

      const refURL = location.origin + location.pathname;
      if (refURL.startsWith('http')) {
        url.searchParams.set('ref_url', encodeURIComponent(refURL));
      }

      if (this.theme) {
        url.searchParams.set('colorMode', this.theme);
      }

      console.log(url.toString());
      this.#iframe.src = url.toString();
    }
  }

  #onMessage = (event: MessageEvent) => {
    if (event.origin !== EMBED_URL || event.data.id !== this.#postId) return;

    const height = event.data.height;
    if (height) {
      this.#iframe.style.height = height + 'px';
    }
  };
}
