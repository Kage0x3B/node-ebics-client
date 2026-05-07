import { defineConfig } from 'tsdown';

export default defineConfig([
	{
		entry: ['index.ts', 'lib/**/*.ts'],
		format: ['esm'],
		outDir: 'dist/esm',
		dts: true,
		clean: true,
		unbundle: true,
		platform: 'node',
		target: 'node22',
		sourcemap: true,
	},
	{
		entry: ['index.ts', 'lib/**/*.ts'],
		format: ['cjs'],
		outDir: 'dist/cjs',
		dts: true,
		clean: true,
		unbundle: true,
		platform: 'node',
		target: 'node22',
		sourcemap: true,
		outExtensions: () => ({
			js: '.cjs',
			dts: '.d.cts',
		}),
	},
]);
