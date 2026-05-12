import { defineConfig, type Options } from 'tsup'

const sharedConfig = {
  sourcemap: true,
  target: 'es2020',
  outDir: 'dist',
  splitting: false,
  minify: false,
} satisfies Options

const emitDeclarations = process.env.NODE_ENV !== 'development'

export default defineConfig([
  {
    ...sharedConfig,
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: emitDeclarations,
    clean: true,
  },
  {
    ...sharedConfig,
    entry: ['src/cli.ts', 'src/daemon-cli.ts', 'src/proxy-cli.ts', 'src/call-cli.ts'],
    format: ['esm'],
    clean: false,
  },
])
