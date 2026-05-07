'use strict';

const genericDownload = require('./generic-download');

module.exports = options => genericDownload({
	serviceName: 'REP',
	msgName: 'camt.054',
	containerType: 'ZIP',
	...options,
});
