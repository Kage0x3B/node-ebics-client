import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
	{
		ignores: [
			'dist/',
			'node_modules/',
			'.verify/',
			'test-built/',
			'examples/config/',
			'coverage/',
			'.nyc_output/',
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		languageOptions: {
			globals: {
				...globals.node,
			},
			parserOptions: {
				ecmaVersion: 2022,
				sourceType: 'module',
			},
		},
		rules: {
			// pragmatic for a library that interops with untyped XML/RSA/forge APIs
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unsafe-function-type': 'off',
			'@typescript-eslint/no-empty-object-type': 'off',
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
				},
			],
			'no-empty': ['error', { allowEmptyCatch: true }],
			'no-useless-escape': 'off',
			// preserves original pre-migration patterns rather than forcing rewrites:
			'no-useless-catch': 'off',
			'no-useless-assignment': 'off',
		},
	},
	{
		files: ['test/**/*.ts'],
		rules: {
			'@typescript-eslint/no-unused-expressions': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
		},
	},
	{
		files: ['examples/**/*.ts'],
		rules: {
			'@typescript-eslint/no-unused-vars': 'off',
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-expressions': 'off',
		},
	},
	{
		files: ['scripts/**/*.{js,mjs,cjs}'],
		rules: {
			'@typescript-eslint/no-unused-vars': 'off',
			'no-unused-vars': 'off',
		},
	},
);
