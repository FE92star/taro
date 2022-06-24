import * as path from 'path'
import { EventEmitter } from 'events'
import { merge } from 'lodash'
import { AsyncSeriesWaterfallHook } from 'tapable'
import { IProjectConfig, PluginItem } from '@tarojs/taro/types/compile'
import {
  NODE_MODULES,
  recursiveFindNodeModules,
  createBabelRegister,
  createDebug
} from '@tarojs/helper'
import * as helper from '@tarojs/helper'

import {
  IPreset,
  IPluginsObject,
  IPlugin,
  IPaths,
  IHook,
  ICommand,
  IPlatform
} from './utils/types'
import {
  PluginType,
  IS_MODIFY_HOOK,
  IS_ADD_HOOK,
  IS_EVENT_HOOK
} from './utils/constants'
import { mergePlugins, resolvePresetsOrPlugins, convertPluginsToObject, printHelpLog } from './utils'
import Plugin from './Plugin'
import Config from './Config'

interface IKernelOptions {
  appPath: string
  presets?: PluginItem[]
  plugins?: PluginItem[]
}

export default class Kernel extends EventEmitter {
  appPath: string
  isWatch: boolean
  isProduction: boolean
  optsPresets: PluginItem[] | void
  optsPlugins: PluginItem[] | void
  plugins: Map<string, IPlugin>
  paths: IPaths
  extraPlugins: IPluginsObject
  config: Config
  initialConfig: IProjectConfig
  hooks: Map<string, IHook[]>
  methods: Map<string, ((...args: any[]) => void)[]>
  commands: Map<string, ICommand>
  platforms: Map<string, IPlatform>
  helper: any
  runOpts: any
  debugger: any

  constructor (options: IKernelOptions) {
    super()
    this.debugger = process.env.DEBUG === 'Taro:Kernel' ? createDebug('Taro:Kernel') : function () {}
    this.appPath = options.appPath || process.cwd()
    this.optsPresets = options.presets
    this.optsPlugins = options.plugins
    this.hooks = new Map()
    this.methods = new Map()
    this.commands = new Map()
    this.platforms = new Map()
    this.initHelper() // 初始化工具函数（作用-helper对象直接挂载到Kernel实例下，方便调用）
    this.initConfig() // 初始化配置
    this.initPaths() // 初始化相关文件的路径信息
  }

  initConfig () {
    this.config = new Config({
      appPath: this.appPath
    })
    this.initialConfig = this.config.initialConfig
    this.debugger('initConfig', this.initialConfig)
  }

  initPaths () {
    this.paths = {
      appPath: this.appPath,
      nodeModulesPath: recursiveFindNodeModules(path.join(this.appPath, NODE_MODULES))
    } as IPaths
    if (this.config.isInitSuccess) {
      Object.assign(this.paths, {
        configPath: this.config.configPath,
        sourcePath: path.join(this.appPath, this.initialConfig.sourceRoot as string),
        outputPath: path.join(this.appPath, this.initialConfig.outputRoot as string)
      })
    }
    // JSON.stringify的第三个参数控制字符串的间距
    // JSON.stringify({a: 1}, null, 2) --> '{\n  "a": 1\n}'
    this.debugger(`initPaths:${JSON.stringify(this.paths, null, 2)}`)
  }

  initHelper () {
    this.helper = helper
    this.debugger('initHelper')
  }

  initPresetsAndPlugins () {
    const initialConfig = this.initialConfig
    // 合并插件和初始化配置的presets/plugins
    const allConfigPresets = mergePlugins(this.optsPresets || [], initialConfig.presets || [])()
    const allConfigPlugins = mergePlugins(this.optsPlugins || [], initialConfig.plugins || [])()
    this.debugger('initPresetsAndPlugins', allConfigPresets, allConfigPlugins)
    process.env.NODE_ENV !== 'test' &&
    createBabelRegister({
      only: [...Object.keys(allConfigPresets), ...Object.keys(allConfigPlugins)]
    })
    this.plugins = new Map()
    this.extraPlugins = {}
    // 加载所有的presets/plugins
    this.resolvePresets(allConfigPresets)
    this.resolvePlugins(allConfigPlugins)
  }

  resolvePresets (presets) {
    const allPresets = resolvePresetsOrPlugins(this.appPath, presets, PluginType.Preset)
    // 初始化所有的presets
    while (allPresets.length) {
      this.initPreset(allPresets.shift()!)
    }
  }

  resolvePlugins (plugins) {
    plugins = merge(this.extraPlugins, plugins)
    const allPlugins = resolvePresetsOrPlugins(this.appPath, plugins, PluginType.Plugin)

    while (allPlugins.length) {
      this.initPlugin(allPlugins.shift()!)
    }
    this.extraPlugins = {}
  }

  initPreset (preset: IPreset) {
    this.debugger('initPreset', preset)
    const { id, path, opts, apply } = preset
    const pluginCtx = this.initPluginCtx({ id, path, ctx: this })
    const { presets, plugins } = apply()(pluginCtx, opts) || {}
    this.registerPlugin(preset)
    if (Array.isArray(presets)) {
      const _presets = resolvePresetsOrPlugins(this.appPath, convertPluginsToObject(presets)(), PluginType.Preset)
      while (_presets.length) {
        this.initPreset(_presets.shift()!)
      }
    }
    if (Array.isArray(plugins)) {
      this.extraPlugins = merge(this.extraPlugins, convertPluginsToObject(plugins)())
    }
  }

  initPlugin (plugin: IPlugin) {
    const { id, path, opts, apply } = plugin
    const pluginCtx = this.initPluginCtx({ id, path, ctx: this })
    this.debugger('initPlugin', plugin)
    this.registerPlugin(plugin)
    apply()(pluginCtx, opts)
    this.checkPluginOpts(pluginCtx, opts)
  }

  checkPluginOpts (pluginCtx, opts) {
    if (typeof pluginCtx.optsSchema !== 'function') {
      return
    }
    const joi = require('joi')
    const schema = pluginCtx.optsSchema(joi)
    if (!joi.isSchema(schema)) {
      throw new Error(`插件${pluginCtx.id}中设置参数检查 schema 有误，请检查！`)
    }
    const { error } = schema.validate(opts)
    if (error) {
      error.message = `插件${pluginCtx.id}获得的参数不符合要求，请检查！`
      throw error
    }
  }

  registerPlugin (plugin: IPlugin) {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`插件 ${plugin.id} 已被注册`)
    }
    this.plugins.set(plugin.id, plugin)
  }

  initPluginCtx ({ id, path, ctx }: { id: string, path: string, ctx: Kernel }) { // 初始化插件的上下文
    const pluginCtx = new Plugin({ id, path, ctx })
    const internalMethods = ['onReady', 'onStart']
    const kernelApis = [
      'appPath',
      'plugins',
      'platforms',
      'paths',
      'helper',
      'runOpts',
      'initialConfig',
      'applyPlugins'
    ]
    // 注册插件的方法method
    internalMethods.forEach(name => {
      if (!this.methods.has(name)) {
        pluginCtx.registerMethod(name)
      }
    })
    return new Proxy(pluginCtx, {
      get: (target, name: string) => {
        if (this.methods.has(name)) {
          const method = this.methods.get(name)
          if (Array.isArray(method)) {
            return (...arg) => {
              method.forEach(item => {
                item.apply(this, arg)
              })
            }
          }
          return method
        }
        if (kernelApis.includes(name)) {
          return typeof this[name] === 'function' ? this[name].bind(this) : this[name]
        }
        return target[name]
      }
    })
  }

  async applyPlugins (args: string | { name: string, initialVal?: any, opts?: any }) {
    let name
    let initialVal
    let opts
    if (typeof args === 'string') {
      name = args
    } else {
      name = args.name
      initialVal = args.initialVal
      opts = args.opts
    }
    this.debugger('applyPlugins')
    this.debugger(`applyPlugins:name:${name}`)
    this.debugger(`applyPlugins:initialVal:${initialVal}`)
    this.debugger(`applyPlugins:opts:${opts}`)
    if (typeof name !== 'string') {
      throw new Error('调用失败，未传入正确的名称！')
    }
    const hooks = this.hooks.get(name) || []
    if (!hooks.length) {
      return await initialVal
    }
    const waterfall = new AsyncSeriesWaterfallHook(['arg']) // 异步串行函数，上一个监听函数的返回结果作为下一个函数的参数
    if (hooks.length) {
      const resArr: any[] = []
      for (const hook of hooks) {
        waterfall.tapPromise({
          name: hook.plugin!,
          stage: hook.stage || 0,
          // @ts-ignore
          before: hook.before
        }, async arg => {
          const res = await hook.fn(opts, arg)
          if (IS_MODIFY_HOOK.test(name) && IS_EVENT_HOOK.test(name)) {
            return res
          }
          if (IS_ADD_HOOK.test(name)) {
            resArr.push(res)
            return resArr
          }
          return null
        })
      }
    }
    return await waterfall.promise(initialVal)
  }

  runWithPlatform (platform) {
    if (!this.platforms.has(platform)) {
      throw new Error(`不存在编译平台 ${platform}`)
    }
    const withNameConfig = this.config.getConfigWithNamed(platform, this.platforms.get(platform)!.useConfigName)
    return withNameConfig
  }

  setRunOpts (opts) {
    this.runOpts = opts
  }

  runHelp (name: string) {
    const command = this.commands.get(name)
    const defaultOptionsMap = new Map()
    defaultOptionsMap.set('-h, --help', 'output usage information')
    let customOptionsMap = new Map()
    if (command?.optionsMap) {
      customOptionsMap = new Map(Object.entries(command?.optionsMap))
    }
    const optionsMap = new Map([...customOptionsMap, ...defaultOptionsMap])
    printHelpLog(name, optionsMap, command?.synopsisList ? new Set(command?.synopsisList) : new Set())
  }

  async run (args: string | { name: string, opts?: any }) { // 执行插件
    let name
    let opts
    if (typeof args === 'string') {
      name = args
    } else {
      name = args.name
      opts = args.opts
    }
    this.debugger('command:run')
    this.debugger(`command:run:name:${name}`)
    this.debugger('command:runOpts')
    this.debugger(`command:runOpts:${JSON.stringify(opts, null, 2)}`)
    this.setRunOpts(opts)

    this.debugger('initPresetsAndPlugins')
    this.initPresetsAndPlugins() // 初始化presets/plugins

    await this.applyPlugins('onReady') // 异步执行插件的onReady方法

    this.debugger('command:onStart')
    await this.applyPlugins('onStart') // 异步执行插件的onStart方法

    if (!this.commands.has(name)) {
      throw new Error(`${name} 命令不存在`)
    }

    if (opts?.isHelp) { // 注册插件的help信息
      return this.runHelp(name)
    }

    if (opts?.options?.platform) {
      opts.config = this.runWithPlatform(opts.options.platform)
      await this.applyPlugins({
        name: 'modifyRunnerOpts',
        opts: {
          opts: opts?.config
        }
      })
    }

    await this.applyPlugins({
      name,
      opts
    })
  }
}
