import { dateRange } from '../../utils.js';
import type { PredefinedDownloadFunctionH004 } from './types.js';

const VMK = ((start: string | Date = null as never, end: string | Date = null as never) => ({
	version: 'h004',
	orderDetails: {
		OrderType: 'VMK',
		OrderAttribute: 'DZHNN',
		StandardOrderParams: dateRange(start, end),
	},
	operation: 'download',
})) as unknown as PredefinedDownloadFunctionH004;

export default VMK;
