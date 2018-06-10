import {
  internal_safe_get as safeGet,
  internal_safe_set as safeSet
} from '@tarojs/taro'

import { isEmptyObject, getPrototypeChain } from './util'

const eventPreffix = '__event_'
const rootScopeKey = '__root_'
const componentPath = 'componentPath'
const scopeMap = {}
const pageExtraFns = ['onPullDownRefresh', 'onReachBottom', 'onShareAppMessage', 'onPageScroll', 'onTabItemTap']

function processEvent (pagePath, eventHandlerName, obj) {
  let newEventHandlerName = eventHandlerName.replace(eventPreffix, '')
  if (obj[newEventHandlerName]) {
    return
  }
  obj[newEventHandlerName] = function (event) {
    if (event) {
      event.preventDefault = function () {}
      event.stopPropagation = function () {}
      Object.assign(event.target, event.detail)
      Object.assign(event.currentTarget, event.detail)
    }
    const dataset = event.currentTarget.dataset
    const theComponent = scopeMap[pagePath][dataset[componentPath] || rootScopeKey]
    let scope = theComponent
    const bindArgs = {}
    const componentClassName = dataset['componentClass']
    const newEventHandlerNameLower = newEventHandlerName.toLocaleLowerCase()
    Object.keys(dataset).forEach(key => {
      let keyLower = key.toLocaleLowerCase()
      if (keyLower.indexOf('event') === 0) {
        keyLower = keyLower.replace('event', '')
        keyLower = componentClassName ? `${componentClassName}__${keyLower}` : keyLower
        keyLower = keyLower.toLocaleLowerCase()
        if (keyLower.indexOf(newEventHandlerNameLower) >= 0) {
          const argName = keyLower.replace(newEventHandlerNameLower, '')
          bindArgs[argName] = dataset[key]
        }
      }
    })
    if (!isEmptyObject(bindArgs)) {
      if (bindArgs['scope'] !== 'this') {
        scope = bindArgs['scope']
      }
      delete bindArgs['scope']
      const realArgs = Object.keys(bindArgs)
        .sort()
        .map(key => bindArgs[key])

      realArgs.push(event)
      const newHandler = () => {
        return theComponent[eventHandlerName].apply(scope, realArgs)
      }
      newHandler()
    } else {
      if (dataset[componentPath]) {
        scope = scopeMap[pagePath][dataset[componentPath] || rootScopeKey]
      }
      theComponent[eventHandlerName].call(scope, event)
    }
  }
}
function initPage (weappPageConf, page, options) {
  const pagePath = options.path
  scopeMap[pagePath] = scopeMap[pagePath] || {}
  function recurrenceComponent (weappPageConf, component, path) {
    component.$path = path || ''
    component.props.$path = component.$path
    if (path) {
      scopeMap[pagePath][path] = component
    } else {
      scopeMap[pagePath][rootScopeKey] = component
    }
    if (!isEmptyObject(component.$components)) {
      Object.getOwnPropertyNames(component.$components).forEach(function (name) {
        const _class = component.$components[name]
        const comPath = `${component.$path}$$${name}`
        let _props = (component.$props || {})[name] || {}
        let props = typeof _props === 'function' ? _props.call(component) : _props
        props = transformPropsForComponent(props, _class.defaultProps, _class.propTypes)
        const child = new _class(props)
        component.$$components[name] = child

        recurrenceComponent(weappPageConf, child, comPath)
      })
    }
    for (const k in component) {
      if (k.indexOf(eventPreffix) >= 0) {
        page[k.replace(eventPreffix, '')] = component[k]
        processEvent(pagePath, k, weappPageConf)
      }
    }
    const prototypeChain = getPrototypeChain(component)
    prototypeChain.forEach(item => {
      Object.getOwnPropertyNames(item).forEach(fn => {
        if (fn.indexOf(eventPreffix) >= 0) {
          page[fn.replace(eventPreffix, '')] = component[fn]
          processEvent(pagePath, fn, weappPageConf)
        }
      })
    })

    return weappPageConf
  }
  return recurrenceComponent(weappPageConf, page)
}

export function processDynamicComponents (page) {
  const pagePath = page.path
  scopeMap[pagePath] = scopeMap[pagePath] || {}
  function recursiveDynamicComponents (component) {
    if (component.$dynamicComponents && !isEmptyObject(component.$dynamicComponents)) {
      component.$$dynamicComponents = component.$$dynamicComponents || {}
      Object.getOwnPropertyNames(component.$dynamicComponents).forEach(name => {
        const dynamicComponetFn = component.$dynamicComponents[name]
        const loopRes = dynamicComponetFn()
        const stateName = loopRes.stateName
        const loopComponents = loopRes.loopComponents
        const stateData = safeGet(component.state, stateName)
        recurrence(loopComponents, stateData)
        function recurrence (loopComponents, stateData) {
          loopComponents.forEach(item => {
            const _class = item.path
            const components = item.components
            const children = item.children
            const subscript = item.subscript
            stateData = subscript ? safeGet(stateData, subscript) : stateData
            if (!stateData) {
              return
            }
            if (components && components.length) {
              components.forEach(function (item, index) {
                const comPath = `${component.$path}$$${item.fn}`
                let child
                Object.getOwnPropertyNames(component.$$dynamicComponents).forEach(c => {
                  if (c === comPath) {
                    child = component.$$dynamicComponents[c]
                  }
                })
                const props = transformPropsForComponent(item.body, _class.defaultProps)
                if (!child) {
                  child = new _class(props)
                  child.$path = comPath
                  child.props.$path = comPath
                  child._init(component.$scope)
                  child._initData(component.$root || component, component)
                  recursiveDynamicComponents(child)
                  componentTrigger(child, 'componentWillMount')
                } else {
                  child.$path = comPath
                  child.props = props
                  child.props.$path = comPath
                  child.state = child._createData()
                  child._init(component.$scope)
                  child._initData(component.$root || component, component)
                  recursiveDynamicComponents(child)
                }

                if (stateData) {
                  stateData[index] = Object.assign({}, child.props, { ...stateData[index] }, child.state)
                }
                component.$$dynamicComponents[comPath] = child
                scopeMap[pagePath][comPath] = child
                for (const k in child) {
                  if (k.indexOf(eventPreffix) >= 0) {
                    processEvent(pagePath, k, component)
                  }
                }
                const prototypeChain = getPrototypeChain(child)
                prototypeChain.forEach(item => {
                  Object.getOwnPropertyNames(item).forEach(fn => {
                    if (fn.indexOf(eventPreffix) >= 0) {
                      processEvent(pagePath, fn, component)
                    }
                  })
                })
                if (item.children && item.children.length) {
                  recurrence(item.children, stateData[index])
                }
                recursiveDynamicComponents(item)
              })
            }
            if (children && children.length) {
              stateData.forEach(item => {
                recurrence(children, item)
              })
            }
          })
        }
      })
    }
  }
  recursiveDynamicComponents(page)
}

function componentTrigger (component, key) {
  if (key === 'componentWillUnmount') {
    component._dirty = true
    component._disable = true
  }
  Object.getOwnPropertyNames(component.$$components || {}).forEach(name => {
    componentTrigger(component.$$components[name], key)
  })
  component[key] && typeof component[key] === 'function' && component[key]()
  if (key === 'componentWillMount') {
    if (component.$isComponent) {
      component.$router.params = component.$root.$router.params
    }
    component._dirty = false
    component._disable = false
    component.state = component.getState()
    if (!component.$isComponent) {
      component.forceUpdate()
    }
  }
}

function transformPropsForComponent (props, defaultProps, propTypes) {
  const newProps = {}
  for (const propName in props) {
    const propValue = props[propName]
    newProps[propName] = propValue
  }
  if (defaultProps) {
    for (const propName in defaultProps) {
      if (newProps[propName] === undefined) {
        newProps[propName] = defaultProps[propName]
      }
    }
  }
  if (propTypes) {
    for (const propName in propTypes) {
      if (newProps[propName] === undefined) {
        newProps[propName] = propTypes[propName]
      }
    }
  }
  return newProps
}

function createPage (PageClass, options) {
  const pageProps = transformPropsForComponent({}, PageClass.defaultProps, PageClass.propTypes)
  const page = new PageClass(pageProps)
  page.$isComponent = false
  page.path = options.path
  const weappPageConf = {
    onLoad (options) {
      page._init(this)
      page.$router.params = options
      componentTrigger(page, 'componentWillMount')
    },
    onReady () {
      componentTrigger(page, 'componentDidMount')
    },
    onShow () {
      componentTrigger(page, 'componentDidShow')
    },
    onHide () {
      componentTrigger(page, 'componentDidHide')
    },
    onUnload () {
      componentTrigger(page, 'componentWillUnmount')
    },
    _setData (data, cb, isRoot) {
      if (isRoot) {
        const filterData = {}
        for (let k in data) {
          if (typeof data[k] !== 'undefined') {
            filterData[k] = data[k]
          }
        }
        this.setData(filterData, () => {
          cb && cb()
        })
      }
    }
  }
  let weappPageConfEvents = initPage(weappPageConf, page, options)
  page._initData()
  processDynamicComponents(page)
  pageExtraFns.forEach(fn => {
    if (typeof page[fn] === 'function') {
      weappPageConf[fn] = page[fn].bind(page)
    }
  })
  const data = {}
  if (page.$usedState && page.$usedState.length) {
    page.$usedState.forEach(key => {
      const value = safeGet(page.$data, key)
      safeSet(data, key, value)
    })
  }
  return Object.assign(weappPageConfEvents, {
    data
  })
}

export default createPage
