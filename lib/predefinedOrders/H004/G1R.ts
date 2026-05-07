import type { PredefinedUploadFunctionH004, UploadOrderH004 } from './types.js';

const G1R: PredefinedUploadFunctionH004 = (document) => ({
	version: 'h004',
	orderDetails: { OrderType: 'G1R', OrderAttribute: 'DZHNN', StandardOrderParams: {} },
	operation: 'upload',
	document,
} as unknown as UploadOrderH004);

export default G1R;
