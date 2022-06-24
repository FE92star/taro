import * as fs from 'fs-extra'
import * as chalk from 'chalk'
import * as chokidar from 'chokidar'

import * as constants from './constants'
import * as utils from './utils'
import * as npm from './npm'
import createBabelRegister, { injectDefineConfigHeader } from './babelRegister'

export const helper = {
  ...constants,
  ...utils,
  npm,
  createBabelRegister,
  injectDefineConfigHeader,
  fs,
  chalk,
  chokidar,
  // debug是一个运行在nodejs环境下的调试工具，只支持commonjs规范，因此只能通过require动态引入
  createDebug: id => require('debug')(id)
}

export default helper
