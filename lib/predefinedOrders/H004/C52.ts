import { dateRange } from '../../utils.js';
import type { PredefinedDownloadFunctionH004 } from './types.js';

const C52 = ((start: string | Date = null as never, end: string | Date = null as never) => ({
	version: 'h004',
	orderDetails: {
		OrderType: 'C52',
		OrderAttribute: 'DZHNN',
		StandardOrderParams: dateRange(start, end),
	},
	operation: 'download',
})) as unknown as PredefinedDownloadFunctionH004;

export default C52;
