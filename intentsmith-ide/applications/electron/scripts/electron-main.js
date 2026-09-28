'use strict';

// Studio 2 owns the window controls. Choose the frame before Theia creates
// BrowserWindow, including profiles which still store the classic native frame.
process.env.THEIA_ELECTRON_DISABLE_NATIVE_ELEMENTS = '1';
require('../lib/backend/electron-main.js');
