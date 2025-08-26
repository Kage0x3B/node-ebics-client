'use strict';

const INI = require('./INI');
const HIA = require('./HIA');
const HPB = require('./HPB');

const genericUpload = require('./generic-upload');
const genericDownload = require('./generic-download');

const DCT = require('./DCT');
const DDD = require('./DDD');
const MCT = require('./MCT');
const SCT = require('./SCT');
const SDD = require('./SDD');
const XCT = require('./XCT');

const EOP = require('./EOP');
const PSR = require('./PSR');
const REP = require('./REP');
const STM = require('./STM');


module.exports = {
	INI,
	HIA,
	HPB,

	// Upload transactions
	genericUpload,
	DCT,
	DDD,
	MCT,
	SCT,
	SDD,
	XCT,

	// Download transactions
	genericDownload,
	EOP,
	PSR,
	REP,
	STM,
};
