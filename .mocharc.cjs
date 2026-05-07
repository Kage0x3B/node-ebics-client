module.exports = {
	extension: ['ts'],
	spec: ['test/**/*.test.ts'],
	loader: 'tsx/esm',
	'node-option': ['import=tsx/esm', 'no-warnings'],
	timeout: 10000,
};
