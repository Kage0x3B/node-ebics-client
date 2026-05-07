import genericUpload from './generic-upload.js';
import type { PredefinedUploadFunctionH005 } from './types.js';

const DCT: PredefinedUploadFunctionH005 = (document, options) => genericUpload(document, {
	serviceName: 'DCT',
	msgName: 'pain.001',
	...options,
});

export default DCT;
