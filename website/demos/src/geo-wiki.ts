type LatLng = [number, number];

export class GeoWiki extends HTMLElement {
  static tagName = 'geo-wiki';

  static define() {
    if (customElements.get(this.tagName)) return;
    customElements.define(this.tagName, this);
  }

  static observedAttributes = ['coordinates'];

  #coordinates: LatLng = [0, 0];
  #results: any[] = [];

  get coordinates() {
    return this.#coordinates;
  }

  set coordinates(coordinates) {
    this.setAttribute('coordinates', coordinates.join(', '));
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    if (name === 'coordinates') {
      this.#coordinates = ((newValue || '').split(',').map((str) => Number(str)) || [0, 0]) as LatLng;
      this.searchWiki(this.#coordinates);
    }
  }

  async searchWiki([lat, long]: LatLng) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      list: 'geosearch',
      gscoord: `${lat}|${long}`,
      gsradius: '1000',
      gslimit: '50',
      origin: '*',
    });
    // https://www.mediawiki.org/wiki/API:Geosearch
    this.#results = await fetch(`https://en.wikipedia.org/w/api.php?${params}`)
      .then((response) => response.json())
      .then((data) => data?.query?.geosearch ?? []);

    this.#renderResults();
  }

  #renderResults() {
    this.firstElementChild?.remove();

    const list = document.createElement('ul');

    for (const result of this.#results) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `https://en.wikipedia.org/wiki/${result.title}`;
      a.textContent = result.title;
      li.appendChild(a);
      list.appendChild(li);
    }

    this.appendChild(list);
  }
}

GeoWiki.define();
