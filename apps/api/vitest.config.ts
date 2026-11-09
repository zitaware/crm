import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// NestJS relies on TypeScript decorator metadata (experimentalDecorators +
// emitDecoratorMetadata), which Vitest's default esbuild transform does not
// emit. unplugin-swc restores it so @nestjs/testing works unchanged under
// Vitest instead of the Jest most Nest examples assume.
//
// Explicit swc options here (rather than reading the project .swcrc) since
// .swcrc forces commonjs output for Nest's own SWC build — Vitest needs
// ESM output for its own runtime.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    root: './',
  },
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2023',
      },
      module: { type: 'es6' },
      swcrc: false,
    }),
  ],
});
