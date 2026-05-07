import type { PredefinedUploadFunctionH004, UploadOrderH004 } from './types.js';

const CCT: PredefinedUploadFunctionH004 = (document) => ({
	version: 'h004',
	orderDetails: { OrderType: 'CCT', OrderAttribute: 'OZHNN', StandardOrderParams: {} },
	operation: 'upload',
	document,
} as UploadOrderH004);

export default CCT;
