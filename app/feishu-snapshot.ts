// 匿名演示数据：当飞书同步服务未配置或暂时不可用时，页面仍可用于功能演示。
// 正式业务数据仅从已授权的飞书多维表格实时读取，不写入此仓库。
export const feishuSnapshotProject = {
  name: "演示项目",
  code: "DEMO-001",
  clientName: "示例客户",
  sourceUrl: "",
  syncedAt: "",
  settings: {
    guaranteeCpm: 25,
    clientCpm: 40,
    defaultMargin: 20,
    rounding: "hundred",
  },
  creators: [
    {
      recordId: "demo-creator-001",
      name: "示例达人 A",
      douyinId: "demo_douyin_001",
      purchaseCost: 4000,
      currentPrice: 0,
      customerCpm: 40,
      organicViews: 0,
      otherCost: 0,
      margin: 20,
      included: true,
      note: "仅用于离线演示",
    },
    {
      recordId: "demo-creator-002",
      name: "示例达人 B",
      douyinId: "demo_douyin_002",
      purchaseCost: 1500,
      currentPrice: 0,
      customerCpm: 40,
      organicViews: 0,
      otherCost: 0,
      margin: 20,
      included: true,
      note: "仅用于离线演示",
    },
  ],
};
