import { dateRange } from '../../utils.js';
import type { PredefinedDownloadFunctionH004 } from './types.js';

const DKI = ((start: string | Date = null as never, end: string | Date = null as never) => ({
	version: 'h004',
	orderDetails: {
		OrderType: 'DKI',
		OrderAttribute: 'DZHNN',
		StandardOrderParams: dateRange(start, end),
	},
	operation: 'download',
})) as unknown as PredefinedDownloadFunctionH004;

export default DKI;
