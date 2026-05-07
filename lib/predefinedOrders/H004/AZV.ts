import type { PredefinedUploadFunctionH004, UploadOrderH004 } from './types.js';

const AZV: PredefinedUploadFunctionH004 = (document) => ({
	version: 'h004',
	orderDetails: { OrderType: 'AZV', OrderAttribute: 'OZHNN', StandardOrderParams: {} },
	operation: 'upload',
	document,
} as UploadOrderH004);

export default AZV;
