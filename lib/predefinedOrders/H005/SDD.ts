import genericUpload from './generic-upload.js';
import type { PredefinedUploadFunctionH005 } from './types.js';

const SDD: PredefinedUploadFunctionH005 = (document, options) => genericUpload(document, {
	serviceName: 'SDD',
	msgName: 'pain.008',
	...options,
});

export default SDD;
