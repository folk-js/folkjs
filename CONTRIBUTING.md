# Contributing

Here are the steps you need to do to get started:

1. Install [NodeJS v22+ and NPM](https://nodejs.org/en/download).

2. Clone the [repository](https://github.com/folk-systems/folk-canvas).

3. Install the deps

```bash
npm i
```

3. Develop/build/test

```bash
# run the dev server
npm run dev

# or build the packages and website
npm run build

# or run the test suites
npm run test
```

## Monorepo

This is a monorepo so there are multiple NPM packages that depend on each other. We are using [wireit](https://github.com/google/wireit) to handle dependencies that arise during development/building/testing.

## Testing

We are using the NodeJS test runner to run tests. If you run the tests in the `JavaScript Debug Terminal` in VSCode then you can add breakpoints in the gutter of the file to debug and examine execution values. In the future we will setup in-browser testing.

## Benchmarking

Performance is a really important to this project and microbenchmarks are one way to quantify and compare performance (while also noting how [careful](https://mrale.ph/blog/2012/12/15/microbenchmarks-fairy-tale.html) you have to be to not mislead yourself). We are using [mitata](https://github.com/evanwashere/mitata) as a benchmark tool. Make sure to read through their docs to understand common pitfalls.
