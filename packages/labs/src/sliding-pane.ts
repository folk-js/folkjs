import { ReactiveElement, css } from '@folkjs/dom/ReactiveElement';
import { ResizeManager } from '@folkjs/dom/ResizeManger';

// https://forum.obsidian.md/t/sliding-panes-andy-matuschak-mode-plugin/7652/60
// https://github.com/deathau/sliding-panes-obsidian
// https://notes.andymatuschak.org/About_these_notes

const ro = new ResizeManager();

export class SlidingPane extends ReactiveElement {
  static override tagName = 'sliding-pane';

  static {
    const styles = new CSSStyleSheet();
    styles.replaceSync(`
      @property --pane-visibility {
        syntax: '<number>';
        inherits: true;
        initial-value: 0;
      }

      @keyframes paneVisibility {
          from {
            --pane-visibility: 0;
          }
          to {
            --pane-visibility: 1;
          }
        }  
    `);
    document.adoptedStyleSheets.push(styles);
  }

  static override styles = css`
    :host {
      background: #fafafc;
      box-sizing: border-box;
      display: flex;
      flex-direction: row;
      flex-wrap: nowrap;
      overflow: auto hidden;
      position: relative;
      scroll-behavior: smooth;
      --pane-min-width: 40;
      --pane-max-width: 625;
      --pane-container-width: 0;
      --pane-width: min(var(--pane-max-width), calc(var(--pane-container-width) * 0.95));
    }

    ::slotted(*) {
      background: white;
      box-sizing: border-box;
      container-type: scroll-state;
      box-shadow: 0px 0px 15px 3px rgba(0, 0, 0, 0.1);
      flex: none;
      padding: 32px;
      overflow-y: scroll;
      position: sticky;
      left: max(
        0px,
        min(
          calc(var(--pane-min-width) * 1px * (sibling-index() - 1)),
          calc(100% - min(95%, var(--pane-max-width) * 1px) - ((sibling-count() - sibling-index()) * 1%))
        )
      );
      width: calc(var(--pane-width) * 1px);

      animation: paneVisibility linear;
      animation-fill-mode: both;
      animation-timeline: scroll(nearest inline);
      animation-range-start: calc(
        (
            ((sibling-index() - 1) * (var(--pane-width) - var(--pane-min-width))) /
              (sibling-count() * var(--pane-width) - var(--pane-container-width))
          ) *
          100%
      );
      animation-range-end: calc(
        (
            (sibling-index() * (var(--pane-max-width) - var(--pane-min-width))) /
              (sibling-count() * var(--pane-max-width) - var(--pane-container-width))
          ) *
          100%
      );
    }

    ::slotted(*:last-child) {
      animation: unset;
    }
  `;

  #slot = document.createElement('slot');

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    root.appendChild(this.#slot);

    return root;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    ro.observe(this, this.#onResize);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    ro.unobserve(this, this.#onResize);
  }

  #onResize = (entry: ResizeObserverEntry) => {
    this.style.setProperty('--pane-container-width', entry.contentRect.width.toString());
  };
}
