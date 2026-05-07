import type { PredefinedUploadFunctionH004, UploadOrderH004 } from './types.js';

const G1V: PredefinedUploadFunctionH004 = (document) => ({
	version: 'h004',
	orderDetails: { OrderType: 'G1V', OrderAttribute: 'DZHNN', StandardOrderParams: {} },
	operation: 'upload',
	document,
} as unknown as UploadOrderH004);

export default G1V;
