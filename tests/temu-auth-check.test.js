import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

async function runAuthCheck({ href, bodyText = '', cookie = '', selectors = {} }) {
  const source = fs.readFileSync(path.resolve('adapters/temu/auth_check.js'), 'utf8')
  const url = new URL(href)
  const document = {
    cookie,
    body: {
      innerText: bodyText,
    },
    querySelector(selector) {
      return selectors[selector] || null
    },
  }
  const context = {
    document,
    location: {
      href,
      hostname: url.hostname,
      pathname: url.pathname,
    },
    RegExp,
    String,
    Boolean,
  }
  context.window = context
  context.globalThis = context
  return await vm.runInNewContext(source, context, { filename: 'adapters/temu/auth_check.js' })
}

test('auth_check treats the loaded mall flux backend page as logged in', async () => {
  const result = await runAuthCheck({
    href: 'https://agentseller.temu.com/main/mall-flux-analysis-full',
    bodyText: '店铺流量 数据中心 查询',
    cookie: 'api_uid=demo; mallid=634418212707202',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.logged_in, true)
})

test('auth_check treats the agentseller shell root as logged in so tasks can navigate back to business pages', async () => {
  const result = await runAuthCheck({
    href: 'https://agentseller.temu.com/',
    bodyText: 'TEMU Agent Center Seller Central',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.logged_in, true)
})

test('auth_check treats kuajingmaihuo seller center pages as logged in', async () => {
  const result = await runAuthCheck({
    href: 'https://seller.kuajingmaihuo.com/wms/tax-free-return-mgt/return-confirm',
    bodyText: '退货确认单 保税仓 处理方式 商家中心',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.logged_in, true)
})

test('auth_check still rejects the login page', async () => {
  const result = await runAuthCheck({
    href: 'https://seller.temu.com/login',
    bodyText: '扫码登录 账号登录',
  })

  assert.equal(result.success, true)
  assert.equal(result.meta.logged_in, false)
})
