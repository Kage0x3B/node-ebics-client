import genericUpload from './generic-upload.js';
import type { PredefinedUploadFunctionH005 } from './types.js';

const SCT: PredefinedUploadFunctionH005 = (document, options) => genericUpload(document, {
	serviceName: 'SCT',
	msgName: 'pain.001',
	...options,
});

export default SCT;
