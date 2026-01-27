import { expect } from 'expect';
import { describe, test } from 'node:test';
import { markdownToFacets } from '../src/facets.ts';

describe('Markdown to Facets', () => {
  test('empty string', () => {
    const postFacets = markdownToFacets('');
    expect(postFacets.length).toBe(1);
    expect(postFacets[0].text).toBe('');
  });

  test('plain text', () => {
    const postFacets = markdownToFacets('Hello World');
    expect(postFacets.length).toBe(1);
    expect(postFacets[0].text).toBe('Hello World');
    expect(postFacets[0].facets.length).toBe(0);
  });

  test.only('link in text', () => {
    const postFacets = markdownToFacets('Hello [World](https://example.com)');
    console.log(postFacets[0].facets[0]);
    expect(postFacets.length).toBe(1);
    expect(postFacets[0].text).toBe('Hello World');
    expect(postFacets[0].facets.length).toBe(1);
  });
});
