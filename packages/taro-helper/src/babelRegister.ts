import * as path from 'path'

import type { PluginItem, NodePath } from '@babel/core'

/**
 * Inject `defineAppConfig` and `definePageConfig`
 * require header at the top of a config file,
 * without the need to specifically require them
 * if they are used
 * babel plugin-自动注入defineAppConfig/definePageConfig
*/
export function injectDefineConfigHeader (babel: any): PluginItem {
  const appConfig = 'function defineAppConfig(config) { return config }'
  const pageConfig = 'function definePageConfig(config) { return config }'

  const prependHeader = (nodePath: NodePath<any>, header: string) => {
    const parsedHeader = babel.parse(header, { filename: '' }).program.body[0]
    nodePath.node.body.unshift(parsedHeader)
  }

  const enterHandler = (nodePath: NodePath<any>) => {
    const { scope, node } = nodePath

    scope.traverse(node, {
      CallExpression (p) {
        const callee = p.node.callee
        // @ts-ignore
        switch (callee.name) {
          case 'defineAppConfig':
            return prependHeader(nodePath, appConfig)
          case 'definePageConfig':
            return prependHeader(nodePath, pageConfig)
        }
      }
    })
  }

  return {
    visitor: {
      Program: { enter: enterHandler }
    }
  }
}

/**
 * 依赖'@bable/register'注入对应的presets和plugins
 * 主要功能是用于对only匹配的目标es module文件，nodejs环境直接读取es module文件会报错，因此在require
 * 模块文件之前注册一个hook，在运行时进行即时编译，从而能正常引入模块
 */
export default function createBabelRegister ({ only }) {
  require('@babel/register')({
    // 编译符合条件的文件路径
    only: Array.from(new Set([...only])),
    presets: [
      require.resolve('@babel/preset-env'),
      require.resolve('@babel/preset-typescript')
    ],
    plugins: [
      injectDefineConfigHeader,
      [require.resolve('@babel/plugin-proposal-decorators'), {
        legacy: true
      }],
      require.resolve('@babel/plugin-proposal-object-rest-spread'),
      [require.resolve('@babel/plugin-transform-runtime'), {
        corejs: false,
        helpers: true,
        regenerator: true,
        useESModules: false,
        version: '^7.7.7',
        absoluteRuntime: path.resolve(__dirname, '..', 'node_modules/@babel/runtime')
      }]
    ],
    // 删除文件的扩展名
    extensions: ['.jsx', '.js', '.ts', '.tsx'],
    babelrc: false,
    configFile: false,
    // 禁止cache缓存
    cache: false
  })
}
