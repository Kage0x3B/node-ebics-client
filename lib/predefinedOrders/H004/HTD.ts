import type { DownloadOrderH004 } from './types.js';

const HTD = {
	version: 'h004',
	orderDetails: {
		OrderType: 'HTD',
		OrderAttribute: 'DZHNN',
		StandardOrderParams: {},
	},
	operation: 'download',
} as unknown as DownloadOrderH004;

export default HTD;
