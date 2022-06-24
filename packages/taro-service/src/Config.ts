import * as path from 'path'
import * as fs from 'fs-extra'

import * as merge from 'webpack-merge' // 合并webpack config
import { IProjectConfig } from '@tarojs/taro/types/compile'
import {
  SOURCE_DIR,
  OUTPUT_DIR,
  ENTRY,
  resolveScriptPath,
  createBabelRegister,
  getModuleDefaultExport
} from '@tarojs/helper'

import {
  CONFIG_DIR_NAME,
  DEFAULT_CONFIG_FILE
} from './utils/constants'

interface IConfigOptions {
  appPath: string,
}

export default class Config {
  appPath: string
  configPath: string
  initialConfig: IProjectConfig
  isInitSuccess: boolean // 初始化成功的标志位
  constructor (opts: IConfigOptions) {
    this.appPath = opts.appPath
    this.init()
  }

  init () {
    // webpack config配置文件路径——'~/config/index.js'
    this.configPath = resolveScriptPath(path.join(this.appPath, CONFIG_DIR_NAME, DEFAULT_CONFIG_FILE))
    if (!fs.existsSync(this.configPath)) {
      this.initialConfig = {}
      this.isInitSuccess = false
    } else {
      // require配置文件之前先注册require hook
      createBabelRegister({
        only: [
          filePath => filePath.indexOf(path.join(this.appPath, CONFIG_DIR_NAME)) >= 0
        ]
      })
      try {
        // 获取初始化配置
        this.initialConfig = getModuleDefaultExport(require(this.configPath))(merge)
        this.isInitSuccess = true
      } catch (err) {
        this.initialConfig = {}
        this.isInitSuccess = false
        console.log(err)
      }
    }
  }

  getConfigWithNamed (platform, useConfigName) {
    const initialConfig = this.initialConfig
    const sourceDirName = initialConfig.sourceRoot || SOURCE_DIR
    const outputDirName = initialConfig.outputRoot || OUTPUT_DIR
    const sourceDir = path.join(this.appPath, sourceDirName)
    const entryName = ENTRY
    const entryFilePath = resolveScriptPath(path.join(sourceDir, entryName))

    const entry = {
      [entryName]: [entryFilePath]
    }

    return {
      entry,
      alias: initialConfig.alias || {},
      copy: initialConfig.copy,
      sourceRoot: sourceDirName,
      outputRoot: outputDirName,
      platform,
      framework: initialConfig.framework,
      baseLevel: initialConfig.baseLevel,
      csso: initialConfig.csso,
      sass: initialConfig.sass,
      uglify: initialConfig.uglify,
      plugins: initialConfig.plugins,
      projectName: initialConfig.projectName,
      env: initialConfig.env,
      defineConstants: initialConfig.defineConstants,
      designWidth: initialConfig.designWidth,
      deviceRatio: initialConfig.deviceRatio,
      projectConfigName: initialConfig.projectConfigName,
      terser: initialConfig.terser,
      ...initialConfig[useConfigName]
    }
  }
}
