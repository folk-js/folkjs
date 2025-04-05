import { WidgetType } from '@codemirror/view';

export class LineWidget extends WidgetType {
  #content: string;

  constructor(content: string) {
    super();
    this.#content = content;
  }

  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-line-widget';
    wrap.style.padding = '4px 0';
    wrap.style.backgroundColor = '#f0f0f0';
    wrap.style.borderRadius = '4px';
    wrap.style.margin = '0';
    wrap.textContent = this.#content;
    return wrap;
  }
}
