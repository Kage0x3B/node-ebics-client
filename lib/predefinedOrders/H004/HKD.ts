import type { DownloadOrderH004 } from './types.js';

const HKD = {
	version: 'h004',
	orderDetails: {
		OrderType: 'HKD',
		OrderAttribute: 'DZHNN',
		StandardOrderParams: {},
	},
	operation: 'download',
} as unknown as DownloadOrderH004;

export default HKD;
