import genericUpload from './generic-upload.js';
import type { PredefinedUploadFunctionH005 } from './types.js';

const MCT: PredefinedUploadFunctionH005 = (document, options) => genericUpload(document, {
	serviceName: 'MCT',
	msgName: 'pain.001',
	...options,
});

export default MCT;
