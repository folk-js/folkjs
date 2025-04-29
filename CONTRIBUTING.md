# Contributing

Here are the steps you need to do to get started:

1. Install [NodeJS v22+ and NPM](https://nodejs.org/en/download).

2. Setup

```bash
# Clone the repository.
git clone https://github.com/folk-js/folkjs.git

cd folk-canvas

# Install dependencies
npm i
```

3. Develop/test/build

```bash
# run the dev server
npm run dev

# or run the test suites
npm run test

# or build the packages and website
npm run build
```

## Monorepo

This monorepo uses [NPM workspaces](https://docs.npmjs.com/cli/v7/using-npm/workspaces) and [wireit](https://github.com/google/wireit).

The main thing to know about

## Testing

We are using the [NodeJS test runner](https://nodejs.org/en/learn/test-runner/using-test-runner) to run tests. If you run the tests in the `JavaScript Debug Terminal` in VSCode then you can add breakpoints in the gutter of the file to debug and examine execution values. In the future we will setup in-browser testing.

## Benchmarking

Performance is a really important to this project and microbenchmarks are one way to quantify and compare performance (while also noting how [careful](https://mrale.ph/blog/2012/12/15/microbenchmarks-fairy-tale.html) you have to be to not mislead yourself). We are using [mitata](https://github.com/evanwashere/mitata) as a benchmark tool. Make sure to read through their docs to understand common pitfalls.

## Performance debugging

Run `npm run deopt <path for JS/TS file>` to generate a log file that can inspected by the [Deopt Explorer VSCode Extension](https://github.com/microsoft/deoptexplorer-vscode). This helps identify polymorphic code path that can be degrading performance. Check out this [post](https://devblogs.microsoft.com/typescript/introducing-deopt-explorer/) for more info.
