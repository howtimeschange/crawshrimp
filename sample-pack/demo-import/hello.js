;(async () => {
  const title = String(document.title || '').trim() || 'example.com'
  return {
    success: true,
    data: [
      {
        项目: '导入测试',
        状态: '已运行',
        页面标题: title,
        当前地址: location.href,
      },
    ],
    meta: {
      action: 'complete',
      has_more: false,
    },
  }
})()
