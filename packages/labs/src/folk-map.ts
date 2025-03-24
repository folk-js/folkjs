import { FolkElement } from '@folkjs/lib';
import { css, unsafeCSS } from '@lit/reactive-element';
import { LatLng, LatLngExpression, LeafletEvent, map, tileLayer } from 'leaflet';
// @ts-ignore
// Vite specific import :(
import leafletCSS from 'leaflet/dist/leaflet.css?inline';

export class RecenterEvent extends Event {
  constructor() {
    super('recenter', { bubbles: true });
  }
}

export class FolkMap extends FolkElement {
  static override tagName = 'folk-map';

  static override styles = css`
    ${unsafeCSS(leafletCSS)}
    :host {
      display: block;
    }

    :host > div {
      height: 100%;
      width: 100%;
    }
  `;

  #container = document.createElement('div');
  #map = map(this.#container);

  override createRenderRoot() {
    const root = super.createRenderRoot();

    root.appendChild(this.#container);

    this.#map.addLayer(
      tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }),
    );

    this.#map.setView(
      (this.getAttribute('coordinates') || '0, 0').split(',').map(Number) as LatLngExpression,
      Number(this.getAttribute('zoom') || 13),
    );

    return root;
  }

  override connectedCallback(): void {
    super.connectedCallback();

    // fix tile loading problem
    setTimeout(() => this.#map.invalidateSize(), 1);

    // Move end includes changes to zoom
    this.#map.on('moveend', this.handleEvent);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();

    // Move end includes changes to zoom
    this.#map.off('moveend', this.handleEvent);
  }

  get lat() {
    return this.coordinates.lat;
  }
  set lat(lat) {
    this.coordinates = [lat, this.lng];
  }

  get lng() {
    return this.coordinates.lng;
  }
  set lng(lng) {
    this.coordinates = [this.lat, lng];
  }

  get coordinates(): LatLng {
    return this.#map.getCenter();
  }
  set coordinates(coordinates: LatLngExpression) {
    this.#map.setView(coordinates);
  }

  get zoomLevel() {
    return this.#map.getZoom();
  }
  set zoomLevel(zoom) {
    this.#map.setZoom(zoom);
  }

  handleEvent = (event: LeafletEvent) => {
    switch (event.type) {
      case 'moveend': {
        this.dispatchEvent(new RecenterEvent());
        break;
      }
    }
  };
}
