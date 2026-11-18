'use strict'
// Redirect require('tap') to the local shim so the genuine test files run unchanged.
const Module = require('module')
const path = require('path')
const SHIM = path.join(__dirname, 'tap.cjs')
const orig = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'tap') return SHIM
  return orig.call(this, request, ...rest)
}
