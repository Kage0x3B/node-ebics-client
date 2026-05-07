import type { DownloadOrderH004 } from './types.js';

const HPD = {
	version: 'h004',
	orderDetails: {
		OrderType: 'HPD',
		OrderAttribute: 'DZHNN',
		StandardOrderParams: {},
	},
	operation: 'download',
} as unknown as DownloadOrderH004;

export default HPD;
