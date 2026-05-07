import type { DownloadOrderH004 } from './types.js';

const HAA = {
	version: 'h004',
	orderDetails: {
		OrderType: 'HAA',
		OrderAttribute: 'DZHNN',
		StandardOrderParams: {},
	},
	operation: 'download',
} as unknown as DownloadOrderH004;

export default HAA;
