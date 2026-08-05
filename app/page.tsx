"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { feishuSnapshotProject } from "./feishu-snapshot";

type RoundingMode = "none" | "hundred" | "thousand";

type Creator = {
  id: string;
  name: string;
  douyinId: string;
  sourceRecordId?: string;
  sourceProject?: string;
  purchaseCost: number;
  customerCpm: number;
  organicViews: number;
  otherCost: number;
  margin: number;
  manualPrice: number | null;
};

type Settings = {
  guaranteeCpm: number;
  clientCpm: number;
  defaultMargin: number;
  rounding: RoundingMode;
};

type ProjectSourceCreator = {
  recordId: string;
  name: string;
  douyinId: string;
  purchaseCost: number;
  currentPrice: number;
  customerCpm: number;
  organicViews: number;
  otherCost: number;
  margin: number;
  included: boolean;
  note: string;
  kpiViews: number;
  guaranteeCost: number;
  totalCost: number;
  actualMargin: number;
  maxPurchaseCost: number;
  riskStatus: string;
};

type ProjectSource = {
  recordId: string;
  name: string;
  code: string;
  clientName: string;
  taxBasis?: string;
  status?: string;
  sourceUrl: string;
  syncedAt: string;
  hiddenCreatorCount: number;
  settings: Settings;
  creators: ProjectSourceCreator[];
};

type ProjectListItem = {
  recordId: string;
  name: string;
  code: string;
  clientName: string;
  status: string;
};

type ChangeValue = string | number;

type FieldChange = {
  before: ChangeValue;
  after: ChangeValue;
};

type CreatorWritebackChange = {
  recordId: string;
  name: string;
  fields: Record<string, FieldChange>;
};

type CreatorWritebackCreate = {
  localId: string;
  name: string;
  douyinId: string;
  fields: Record<string, ChangeValue>;
};

type InvalidCreatorCreate = {
  localId: string;
  name: string;
  message: string;
};

type WritebackPlan = {
  projectChanges: Record<string, FieldChange>;
  creatorChanges: CreatorWritebackChange[];
  creatorCreates: CreatorWritebackCreate[];
  invalidCreatorCreates: InvalidCreatorCreate[];
  totalFieldChanges: number;
  totalWritebackActions: number;
  reviewItemCount: number;
  removedCreatorCount: number;
};

type ResultStatus = "healthy" | "warning" | "danger";
type PricingMode = "target" | "break-even" | "unavailable";

type CreatorResult = Creator & {
  kpiViews: number;
  requiredViews: number;
  guaranteeCost: number;
  totalCost: number;
  targetPrice: number;
  suggestedPrice: number;
  pricingMode: PricingMode;
  activePrice: number;
  actualCpm: number;
  actualProfit: number;
  actualMargin: number;
  maxPurchaseCost: number;
  reductionNeeded: number;
  status: ResultStatus;
};

const STORAGE_KEY = "creator-pricing-calculator-v5-multiproject";
// Local development uses the helper directly. In the intranet deployment this
// becomes "/api" and is forwarded by the company's reverse proxy.
const SYNC_ROOT = (
  process.env.NEXT_PUBLIC_SYNC_ROOT ?? "http://127.0.0.1:3001"
).replace(/\/$/, "");

const snapshotProject: ProjectSource = {
  ...feishuSnapshotProject,
  recordId: "recvqQYcWVdChw",
  hiddenCreatorCount: feishuSnapshotProject.creators.filter(
    (creator) => !creator.included,
  ).length,
  creators: feishuSnapshotProject.creators.map((creator) => ({
    ...creator,
    kpiViews: 0,
    guaranteeCost: 0,
    totalCost: 0,
    actualMargin: 0,
    maxPurchaseCost: 0,
    riskStatus: "",
  })),
};

const defaultSettings: Settings = {
  ...snapshotProject.settings,
};

function sourceCreatorToCreator(
  creator: ProjectSourceCreator,
  projectName: string,
): Creator {
  return {
    id: creator.recordId,
    name: creator.name,
    douyinId: creator.douyinId,
    sourceRecordId: creator.recordId,
    sourceProject: projectName,
    purchaseCost: creator.purchaseCost,
    customerCpm: creator.customerCpm,
    organicViews: creator.organicViews,
    otherCost: creator.otherCost,
    margin: creator.margin,
    manualPrice: creator.currentPrice > 0 ? creator.currentPrice : null,
  };
}

const starterCreators: Creator[] = snapshotProject.creators
  .filter((creator) => creator.included)
  .map((creator) =>
    sourceCreatorToCreator(creator, snapshotProject.name),
);

function cloneStarterCreators() {
  return starterCreators.map((creator) => ({ ...creator }));
}

function normalizeDouyinId(value: string) {
  return value.trim().toLowerCase();
}

const projectFieldLabels: Record<string, string> = {
  guaranteeCpm: "保量成本 CPM",
  clientCpm: "默认客户 CPM",
  defaultMargin: "默认目标毛利率",
  rounding: "报价取整方式",
};

const creatorFieldLabels: Record<string, string> = {
  name: "达人名称",
  douyinId: "抖音号",
  purchaseCost: "采买成本",
  currentPrice: "当前报价",
  customerCpm: "客户 CPM",
  organicViews: "预计自然播放",
  otherCost: "其他成本",
  margin: "目标毛利率",
  kpiViews: "KPI 播放量",
  guaranteeCost: "保量成本",
  totalCost: "总成本",
  actualMargin: "实际毛利率",
  maxPurchaseCost: "最高可承受采买成本",
  riskStatus: "风险状态",
};

function valuesEqual(first: ChangeValue, second: ChangeValue) {
  if (typeof first === "number" && typeof second === "number") {
    return Math.abs(first - second) < 0.000001;
  }
  return String(first ?? "") === String(second ?? "");
}

function buildWritebackPlan(
  project: ProjectSource,
  settings: Settings,
  creators: CreatorResult[],
): WritebackPlan {
  const projectChanges: Record<string, FieldChange> = {};
  (Object.keys(projectFieldLabels) as Array<keyof Settings>).forEach((key) => {
    const before = project.settings[key];
    const after = settings[key];
    if (!valuesEqual(before, after)) {
      projectChanges[key] = { before, after };
    }
  });

  const baselineCreators = new Map(
    project.creators.map((creator) => [creator.recordId, creator]),
  );
  const douyinIdCounts = new Map<string, number>();
  creators.forEach((creator) => {
    const normalizedId = normalizeDouyinId(creator.douyinId);
    if (normalizedId) {
      douyinIdCounts.set(
        normalizedId,
        (douyinIdCounts.get(normalizedId) ?? 0) + 1,
      );
    }
  });
  const creatorChanges: CreatorWritebackChange[] = [];
  const creatorCreates: CreatorWritebackCreate[] = [];
  const invalidCreatorCreates: InvalidCreatorCreate[] = [];
  creators.forEach((creator) => {
    if (!creator.sourceRecordId) {
      const name = creator.name.trim();
      const douyinId = creator.douyinId.trim();
      const hasManualContent =
        Boolean(name) ||
        Boolean(douyinId) ||
        creator.purchaseCost > 0 ||
        creator.organicViews > 0 ||
        creator.otherCost > 0 ||
        creator.manualPrice !== null;
      if (!hasManualContent) return;

      const issues: string[] = [];
      if (!name) issues.push("请填写达人名称");
      if (!douyinId) issues.push("请填写抖音号");
      if (
        douyinId &&
        (douyinIdCounts.get(normalizeDouyinId(douyinId)) ?? 0) > 1
      ) {
        issues.push("抖音号与当前项目中的达人重复");
      }
      if (issues.length) {
        invalidCreatorCreates.push({
          localId: creator.id,
          name: name || "未命名达人",
          message: issues.join("；"),
        });
        return;
      }

      creatorCreates.push({
        localId: creator.id,
        name,
        douyinId,
        fields: {
          name,
          douyinId,
          purchaseCost: creator.purchaseCost,
          currentPrice: creator.activePrice,
          customerCpm: creator.customerCpm,
          organicViews: creator.organicViews,
          otherCost: creator.otherCost,
          margin: creator.margin,
          kpiViews: creator.kpiViews,
          guaranteeCost: creator.guaranteeCost,
          totalCost: creator.totalCost,
          actualMargin: creator.actualMargin,
          maxPurchaseCost: creator.maxPurchaseCost,
          riskStatus:
            creator.status === "healthy"
              ? "满足目标"
              : creator.status === "warning"
                ? "毛利不足"
                : "存在亏损",
        },
      });
      return;
    }
    const baseline = baselineCreators.get(creator.sourceRecordId);
    if (!baseline) return;
    const currentValues: Record<string, ChangeValue> = {
      name: creator.name,
      douyinId: creator.douyinId,
      purchaseCost: creator.purchaseCost,
      currentPrice: creator.activePrice,
      customerCpm: creator.customerCpm,
      organicViews: creator.organicViews,
      otherCost: creator.otherCost,
      margin: creator.margin,
      kpiViews: creator.kpiViews,
      guaranteeCost: creator.guaranteeCost,
      totalCost: creator.totalCost,
      actualMargin: creator.actualMargin,
      maxPurchaseCost: creator.maxPurchaseCost,
      riskStatus:
        creator.status === "healthy"
          ? "满足目标"
          : creator.status === "warning"
            ? "毛利不足"
            : "存在亏损",
    };
    const fields: Record<string, FieldChange> = {};
    Object.keys(creatorFieldLabels).forEach((key) => {
      const before = baseline[key as keyof ProjectSourceCreator] as ChangeValue;
      const after = currentValues[key];
      if (!valuesEqual(before, after)) fields[key] = { before, after };
    });
    if (Object.keys(fields).length) {
      creatorChanges.push({
        recordId: creator.sourceRecordId,
        name: creator.name,
        fields,
      });
    }
  });

  const currentSourceIds = new Set(
    creators
      .map((creator) => creator.sourceRecordId)
      .filter((recordId): recordId is string => Boolean(recordId)),
  );
  const removedCreatorCount = project.creators.filter(
    (creator) => creator.included && !currentSourceIds.has(creator.recordId),
  ).length;
  const totalFieldChanges =
    Object.keys(projectChanges).length +
    creatorChanges.reduce(
      (count, creator) => count + Object.keys(creator.fields).length,
      0,
    );
  const totalWritebackActions =
    totalFieldChanges + creatorCreates.length;
  const reviewItemCount =
    totalWritebackActions + invalidCreatorCreates.length;

  return {
    projectChanges,
    creatorChanges,
    creatorCreates,
    invalidCreatorCreates,
    totalFieldChanges,
    totalWritebackActions,
    reviewItemCount,
    removedCreatorCount,
  };
}

function safeNumber(value: number | string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function numberFromInput(event: React.ChangeEvent<HTMLInputElement>) {
  const rawValue = event.currentTarget.value;
  const normalizedValue = /^0\d/.test(rawValue)
    ? rawValue.replace(/^0+(?=\d)/, "")
    : rawValue;
  if (normalizedValue !== rawValue) {
    event.currentTarget.value = normalizedValue;
  }
  return safeNumber(normalizedValue);
}

function formatMoney(value: number, digits = 0) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(
    Number.isFinite(value) ? value : 0,
  );
}

function formatPercent(value: number) {
  return `${(Number.isFinite(value) ? value : 0).toFixed(1)}%`;
}

function formatSyncTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function formatChangeValue(field: string, value: ChangeValue) {
  if (
    field === "defaultMargin" ||
    field === "margin" ||
    field === "actualMargin"
  ) {
    return `${Number(value).toFixed(1)}%`;
  }
  if (field === "rounding") {
    return value === "thousand"
      ? "向上取整到千元"
      : value === "hundred"
        ? "向上取整到百元"
        : "向上取整到元";
  }
  return String(value);
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function roundPrice(value: number, mode: RoundingMode) {
  const unit = mode === "thousand" ? 1000 : mode === "hundred" ? 100 : 1;
  return Math.ceil((value - unit * 1e-9) / unit) * unit;
}

function calculateCreator(
  creator: Creator,
  settings: Settings,
): CreatorResult {
  const marginRate = Math.min(creator.margin, 99.9) / 100;
  const customerCpm = Math.max(creator.customerCpm, 0.01);
  const fixedCost = creator.purchaseCost + creator.otherCost;
  const organicValueAtClientCpm =
    (creator.organicViews / 1000) * customerCpm;
  const priceWithoutGuarantee = fixedCost / Math.max(1 - marginRate, 0.001);
  const guaranteeRatio = settings.guaranteeCpm / customerCpm;
  const priceDenominator = 1 - marginRate - guaranteeRatio;
  const breakEvenDenominator = 1 - guaranteeRatio;
  let targetPrice = Number.POSITIVE_INFINITY;
  let breakEvenPrice = Number.POSITIVE_INFINITY;

  if (priceWithoutGuarantee <= organicValueAtClientCpm) {
    targetPrice = priceWithoutGuarantee;
  } else if (priceDenominator > 0) {
    targetPrice =
      (fixedCost -
        (creator.organicViews / 1000) * settings.guaranteeCpm) /
      priceDenominator;
  }

  if (fixedCost <= organicValueAtClientCpm) {
    breakEvenPrice = fixedCost;
  } else if (breakEvenDenominator > 0) {
    breakEvenPrice =
      (fixedCost -
        (creator.organicViews / 1000) * settings.guaranteeCpm) /
      breakEvenDenominator;
  }

  const pricingMode: PricingMode = Number.isFinite(targetPrice)
    ? "target"
    : Number.isFinite(breakEvenPrice)
      ? "break-even"
      : "unavailable";
  const suggestedBasePrice =
    pricingMode === "target"
      ? targetPrice
      : pricingMode === "break-even"
        ? breakEvenPrice
        : 0;
  const suggestedPrice = roundPrice(
    Math.max(suggestedBasePrice, 0),
    settings.rounding,
  );
  const activePrice =
    creator.manualPrice !== null ? creator.manualPrice : suggestedPrice;
  const kpiViews = activePrice > 0 ? (activePrice / customerCpm) * 1000 : 0;
  const requiredViews = Math.max(kpiViews - creator.organicViews, 0);
  const guaranteeCost = (requiredViews / 1000) * settings.guaranteeCpm;
  const totalCost = fixedCost + guaranteeCost;
  const actualCpm = activePrice > 0 ? customerCpm : 0;
  const actualProfit = activePrice - totalCost;
  const actualMargin = activePrice > 0 ? (actualProfit / activePrice) * 100 : 0;
  const maxPurchaseCost =
    activePrice * (1 - marginRate) - guaranteeCost - creator.otherCost;
  const reductionNeeded = Math.max(
    0,
    totalCost - activePrice * (1 - marginRate),
  );

  let status: ResultStatus = "healthy";
  if (
    activePrice <= 0 ||
    actualProfit < 0 ||
    pricingMode === "unavailable"
  ) {
    status = "danger";
  } else if (actualMargin + 0.01 < creator.margin) {
    status = "warning";
  }

  return {
    ...creator,
    customerCpm,
    kpiViews,
    requiredViews,
    guaranteeCost,
    totalCost,
    targetPrice,
    suggestedPrice,
    pricingMode,
    activePrice,
    actualCpm,
    actualProfit,
    actualMargin,
    maxPurchaseCost,
    reductionNeeded,
    status,
  };
}

function StatusPill({ status }: { status: ResultStatus }) {
  const labels = {
    healthy: "满足目标",
    warning: "毛利不足",
    danger: "存在亏损",
  };
  return <span className={`status-pill ${status}`}>{labels[status]}</span>;
}

function selectZeroOnFocus(event: React.SyntheticEvent<HTMLElement>) {
  const target = event.target as HTMLInputElement;
  if (
    target.tagName === "INPUT" &&
    target.type === "number" &&
    Number(target.value) === 0
  ) {
    target.select();
  }
}

function MetricCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "accent" | "positive";
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{hint}</span>
    </article>
  );
}

export default function Home() {
  const [project, setProject] = useState<ProjectSource>(snapshotProject);
  const [projects, setProjects] = useState<ProjectListItem[]>([
    {
      recordId: snapshotProject.recordId,
      name: snapshotProject.name,
      code: snapshotProject.code,
      clientName: snapshotProject.clientName,
      status: snapshotProject.status ?? "",
    },
  ]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [creators, setCreators] = useState<Creator[]>(cloneStarterCreators);
  const [hydrated, setHydrated] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [showWriteback, setShowWriteback] = useState(false);
  const [writebackConfirmation, setWritebackConfirmation] = useState("");
  const [writingBack, setWritingBack] = useState(false);
  const [writebackError, setWritebackError] = useState("");
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [writebackConflicts, setWritebackConflicts] = useState<
    Array<{
      scope: string;
      name: string;
      field: string;
      expected: ChangeValue;
      current: ChangeValue;
      desired: ChangeValue;
    }>
  >([]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved) as {
          project?: ProjectSource;
          settings?: Settings;
          creators?: Array<
            Partial<Creator> & { id: string; name: string; kpiViews?: number }
          >;
        };
        const sourceIds = new Set(
          data.project?.creators
            .filter((creator) => creator.included)
            .map((creator) => creator.recordId) ?? [],
        );
        const linkedCreatorCount =
          data.creators?.filter(
            (creator) =>
              creator.sourceRecordId &&
              sourceIds.has(creator.sourceRecordId),
          ).length ?? 0;
        const isCompatibleProjectDraft =
          sourceIds.size > 0 &&
          linkedCreatorCount >= Math.max(1, Math.ceil(sourceIds.size / 2));

        if (
          isCompatibleProjectDraft &&
          data.project &&
          data.settings &&
          data.creators?.length
        ) {
          // 本地草稿只能在浏览器挂载后读取，需要在此一次性恢复状态。
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setProject(data.project);
          setSettings(data.settings);
          const savedDefaultCpm =
            data.settings?.clientCpm ?? defaultSettings.clientCpm;
          setCreators(
            data.creators.map((creator) => ({
              id: creator.id,
              name: creator.name,
              douyinId: creator.douyinId ?? "",
              sourceRecordId: creator.sourceRecordId,
              sourceProject: creator.sourceProject,
              purchaseCost: safeNumber(creator.purchaseCost ?? 0),
              customerCpm: safeNumber(
                creator.customerCpm ?? savedDefaultCpm,
              ),
              organicViews: safeNumber(creator.organicViews ?? 0),
              otherCost: safeNumber(creator.otherCost ?? 0),
              margin: safeNumber(
                creator.margin ??
                  data.settings?.defaultMargin ??
                  defaultSettings.defaultMargin,
              ),
              manualPrice:
                creator.manualPrice === null ||
                creator.manualPrice === undefined
                  ? null
                  : safeNumber(creator.manualPrice),
            })),
          );
        }
      }
    } catch {
      // 本地数据损坏时使用安全默认值。
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ project, settings, creators }),
    );
  }, [project, settings, creators, hydrated]);

  useEffect(() => {
    fetch(`${SYNC_ROOT}/projects`, { cache: "no-store" })
      .then((response) => response.json())
      .then(
        (payload: {
          ok: boolean;
          projects?: ProjectListItem[];
          sourceUrl?: string;
        }) => {
          if (payload.ok && payload.projects?.length) {
            setProjects(payload.projects);
          }
          if (payload.ok && payload.sourceUrl) {
            setProject((current) =>
              current.sourceUrl === payload.sourceUrl
                ? current
                : { ...current, sourceUrl: payload.sourceUrl! },
            );
          }
        },
      )
      .catch(() => {
        // 同步服务不可用时保留当前项目，不影响本地测算。
      });
  }, []);

  const results = useMemo(
    () => creators.map((creator) => calculateCreator(creator, settings)),
    [creators, settings],
  );

  const manualPriceCount = useMemo(
    () => creators.filter((creator) => creator.manualPrice !== null).length,
    [creators],
  );

  const manualUnreachablePriceCount = useMemo(
    () =>
      results.filter(
        (creator) =>
          creator.manualPrice !== null && creator.pricingMode !== "target",
      ).length,
    [results],
  );

  const duplicateDouyinIds = useMemo(() => {
    const counts = new Map<string, number>();
    creators.forEach((creator) => {
      const douyinId = normalizeDouyinId(creator.douyinId);
      if (douyinId) counts.set(douyinId, (counts.get(douyinId) ?? 0) + 1);
    });
    return new Set(
      [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([douyinId]) => douyinId),
    );
  }, [creators]);

  const writebackPlan = useMemo(
    () => buildWritebackPlan(project, settings, results),
    [project, settings, results],
  );

  const summary = useMemo(() => {
    const totalKpi = results.reduce((sum, item) => sum + item.kpiViews, 0);
    const totalPurchase = results.reduce(
      (sum, item) => sum + item.purchaseCost,
      0,
    );
    const totalGuarantee = results.reduce(
      (sum, item) => sum + item.guaranteeCost,
      0,
    );
    const totalCost = results.reduce((sum, item) => sum + item.totalCost, 0);
    const totalRevenue = results.reduce(
      (sum, item) => sum + item.activePrice,
      0,
    );
    const totalProfit = totalRevenue - totalCost;
    const overallCpm = totalKpi > 0 ? totalRevenue / (totalKpi / 1000) : 0;
    const overallMargin =
      totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const healthyCount = results.filter(
      (item) => item.status === "healthy",
    ).length;
    const riskyCount = results.length - healthyCount;
    return {
      totalKpi,
      totalPurchase,
      totalGuarantee,
      totalCost,
      totalRevenue,
      totalProfit,
      overallCpm,
      overallMargin,
      healthyCount,
      riskyCount,
    };
  }, [results]);

  const updateSetting = <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
    if (key === "defaultMargin") {
      setCreators((current) =>
        current.map((creator) => ({
          ...creator,
          margin: Number(value),
        })),
      );
    }
    if (key === "clientCpm") {
      setCreators((current) =>
        current.map((creator) => ({
          ...creator,
          customerCpm: Number(value),
        })),
      );
    }
  };

  const updateCreator = (
    id: string,
    key: keyof Creator,
    value: string | number | null,
  ) => {
    setCreators((current) =>
      current.map((creator) =>
        creator.id === id
          ? {
              ...creator,
              [key]:
                key === "name" ||
                key === "douyinId" ||
                key === "sourceRecordId" ||
                key === "sourceProject" ||
                value === null
                  ? value
                  : safeNumber(value),
            }
          : creator,
      ),
    );
  };

  const focusCreatorInput = (creatorId: string) => {
    window.requestAnimationFrame(() => {
      tableWrapRef.current?.scrollTo({ left: 0, behavior: "smooth" });
      const nameInputs = document.querySelectorAll<HTMLInputElement>(
        `[data-creator-name-id="${creatorId}"]`,
      );
      const visibleInput = [...nameInputs].find(
        (input) => input.offsetParent !== null,
      );
      visibleInput?.focus();
    });
  };

  const resetAllManualPrices = () => {
    if (manualPriceCount === 0) return;
    const unreachableNotice =
      manualUnreachablePriceCount > 0
        ? `其中 ${manualUnreachablePriceCount} 位达人当前无法达到目标毛利，将采用最低不亏价。`
        : "";
    const confirmed = window.confirm(
      `将 ${manualPriceCount} 位达人的手动报价全部恢复为按当前全局参数计算的建议价？${unreachableNotice}此操作只修改本地草稿。`,
    );
    if (!confirmed) return;
    setCreators((current) =>
      current.map((creator) =>
        creator.manualPrice === null
          ? creator
          : { ...creator, manualPrice: null },
      ),
    );
    setSyncMessage(
      `已将 ${manualPriceCount} 位达人的当前报价批量恢复为最新建议价`,
    );
  };

  const addCreator = () => {
    const id = makeId();
    setCreators((current) => [
      {
        id,
        name: "",
        douyinId: "",
        sourceProject: project.name,
        purchaseCost: 0,
        customerCpm: settings.clientCpm,
        organicViews: 0,
        otherCost: 0,
        margin: settings.defaultMargin,
        manualPrice: null,
      },
      ...current,
    ]);
    focusCreatorInput(id);
  };

  const duplicateCreator = (creator: Creator) => {
    const id = makeId();
    setCreators((current) => [
      {
        ...creator,
        id,
        name: `${creator.name || "达人"} 副本`,
        douyinId: "",
        sourceRecordId: undefined,
        sourceProject: project.name,
      },
      ...current,
    ]);
    focusCreatorInput(id);
  };

  const removeCreator = (id: string) => {
    setCreators((current) => {
      if (current.length === 1) {
        return [
          {
            ...starterCreators[0],
            id: makeId(),
            name: "达人1",
            douyinId: "",
            sourceRecordId: undefined,
            margin: settings.defaultMargin,
            customerCpm: settings.clientCpm,
          },
        ];
      }
      return current.filter((creator) => creator.id !== id);
    });
  };

  const applyProjectData = (nextProject: ProjectSource) => {
    setProject(nextProject);
    setSettings({ ...nextProject.settings });
    setCreators(
      nextProject.creators
        .filter((creator) => creator.included)
        .map((creator) =>
          sourceCreatorToCreator(creator, nextProject.name),
        ),
    );
    setWritebackConfirmation("");
    setWritebackError("");
    setWritebackConflicts([]);
  };

  const fetchProject = async (projectName: string) => {
    const response = await fetch(
      `${SYNC_ROOT}/project?name=${encodeURIComponent(projectName)}`,
      { cache: "no-store" },
    );
    const payload = (await response.json()) as {
      ok: boolean;
      project?: ProjectSource;
      message?: string;
    };
    if (!response.ok || !payload.ok || !payload.project) {
      throw new Error(payload.message ?? "飞书同步失败");
    }
    return payload.project;
  };

  const resetAll = () => {
    const shouldReset = window.confirm(
      `恢复“${project.name}”最近一次同步的数据？当前页面调整将被覆盖。`,
    );
    if (!shouldReset) return;
    setSettings({ ...project.settings });
    setCreators(
      project.creators
        .filter((creator) => creator.included)
        .map((creator) => sourceCreatorToCreator(creator, project.name)),
    );
    setSyncMessage("已恢复最近一次同步的数据");
  };

  const switchProject = async (projectName: string) => {
    if (!projectName || projectName === project.name) return;
    const confirmed = window.confirm(
      `切换到“${projectName}”会覆盖当前页面草稿，但不会删除或修改飞书记录。是否继续？`,
    );
    if (!confirmed) return;

    setSyncing(true);
    setSyncMessage("");
    try {
      const nextProject = await fetchProject(projectName);
      applyProjectData(nextProject);
      setSyncMessage(
        `已切换到“${nextProject.name}”，显示 ${nextProject.creators.length} 位达人`,
      );
    } catch (error) {
      setSyncMessage(
        error instanceof Error
          ? `切换失败：${error.message}`
          : "切换失败，请稍后重试",
      );
    } finally {
      setSyncing(false);
    }
  };

  const syncFromFeishu = async () => {
    const confirmed = window.confirm(
      `从飞书重新同步“${project.name}”？当前页面调整将被飞书数据覆盖。`,
    );
    if (!confirmed) return;

    setSyncing(true);
    setSyncMessage("");
    try {
      const nextProject = await fetchProject(project.name);
      applyProjectData(nextProject);
      setSyncMessage(
        `同步成功：显示 ${nextProject.creators.length} 位达人${
          nextProject.hiddenCreatorCount > 0
            ? `，已隐藏 ${nextProject.hiddenCreatorCount} 位未参与达人`
            : ""
        }`,
      );
    } catch (error) {
      setSyncMessage(
        error instanceof Error
          ? `同步失败：${error.message}`
          : "同步失败，请稍后重试",
      );
    } finally {
      setSyncing(false);
    }
  };

  const openWritebackReview = () => {
    setWritebackError("");
    setWritebackConflicts([]);
    setWritebackConfirmation("");
    if (writebackPlan.reviewItemCount === 0) {
      setSyncMessage("当前没有可写回的变更或新增达人");
      return;
    }
    setShowWriteback(true);
  };

  const submitWriteback = async () => {
    if (writebackPlan.invalidCreatorCreates.length > 0) {
      setWritebackError("请先补全或修正待新增达人的信息");
      return;
    }
    if (writebackConfirmation.trim() !== project.code) {
      setWritebackError("输入的项目 ID 与当前项目编号不一致");
      return;
    }

    setWritingBack(true);
    setWritebackError("");
    setWritebackConflicts([]);
    try {
      const response = await fetch(`${SYNC_ROOT}/writeback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: project.name,
          projectCode: project.code,
          projectRecordId: project.recordId,
          projectChanges: writebackPlan.projectChanges,
          creatorChanges: writebackPlan.creatorChanges,
          creatorCreates: writebackPlan.creatorCreates,
        }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        project?: ProjectSource;
        conflicts?: typeof writebackConflicts;
        updatedProjectFields?: number;
        updatedCreatorRecords?: number;
        createdCreatorRecords?: number;
      };
      if (response.status === 409 && payload.conflicts?.length) {
        setWritebackConflicts(payload.conflicts);
        setWritebackError(
          "检测到云端冲突或重复达人，已停止写回。请核对后重新同步。",
        );
        return;
      }
      if (!response.ok || !payload.ok || !payload.project) {
        throw new Error(payload.message ?? "飞书写回失败");
      }

      applyProjectData(payload.project);
      setShowWriteback(false);
      setSyncMessage(
        `写回成功：更新 ${payload.updatedProjectFields ?? 0} 个项目字段、${
          payload.updatedCreatorRecords ?? 0
        } 位达人，新增 ${payload.createdCreatorRecords ?? 0} 位达人`,
      );
    } catch (error) {
      setWritebackError(
        error instanceof Error
          ? `写回失败：${error.message}`
          : "写回失败，请稍后重试",
      );
    } finally {
      setWritingBack(false);
    }
  };

  const exportCsv = () => {
    const rows = [
      [
        "项目名称",
        "达人名称",
        "抖音号",
        "飞书记录ID",
        "采买成本",
        "当前报价",
        "客户CPM",
        "KPI播放量",
        "预计自然播放",
        "其他成本",
        "目标毛利率",
        "需保量播放",
        "保量成本",
        "总成本",
        "目标毛利卖价",
        "实际毛利额",
        "实际毛利率",
        "最高可承受采买成本",
        "状态",
      ],
      ...results.map((item) => [
        item.sourceProject ?? project.name,
        item.name,
        item.douyinId,
        item.sourceRecordId ?? "",
        item.purchaseCost,
        item.activePrice.toFixed(2),
        item.customerCpm.toFixed(2),
        item.kpiViews,
        item.organicViews,
        item.otherCost,
        `${item.margin}%`,
        item.requiredViews,
        item.guaranteeCost.toFixed(2),
        item.totalCost.toFixed(2),
        Number.isFinite(item.targetPrice) ? item.targetPrice.toFixed(2) : "",
        item.actualProfit.toFixed(2),
        `${item.actualMargin.toFixed(2)}%`,
        item.maxPurchaseCost.toFixed(2),
        item.status === "healthy"
          ? "满足目标"
          : item.status === "warning"
            ? "毛利不足"
            : "存在亏损",
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `达人报价测算_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const theoreticalMaxMargin =
    settings.clientCpm > 0
      ? ((settings.clientCpm - settings.guaranteeCpm) /
          settings.clientCpm) *
        100
      : 0;

  return (
    <main className="page-shell" onFocusCapture={selectZeroOnFocus}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">算</span>
          <div>
            <strong>达人报价测算器</strong>
            <span>短视频保量合作</span>
          </div>
        </div>
        <div className="top-actions">
          <span className="autosave-indicator">
            <i />
            已自动保存在本机
          </span>
          <button className="button ghost" onClick={resetAll}>
            恢复同步数据
          </button>
          <button className="button dark" onClick={exportCsv}>
            导出 Excel
          </button>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">PRICING CONTROL DESK</p>
          <h1>
            每一笔采买，
            <br />
            <em>都在安全毛利内。</em>
          </h1>
          <p className="hero-copy">
            输入采买成本、卖价和客户 CPM，自动反推 KPI 播放量并核算真实毛利。
          </p>
          <a
            className="faq-link"
            href="https://qbw4tzdxpr.feishu.cn/docx/ELZ5dShmNoD5tXxYW39cCQCWnfb"
            target="_blank"
            rel="noreferrer"
          >
            <span>首次使用？</span>
            达人报价测算器｜使用说明与 FAQ <b aria-hidden="true">↗</b>
          </a>
        </div>
        <div className="hero-insight">
          <span>当前模型的理论最高毛利率</span>
          <strong>{formatPercent(theoreticalMaxMargin)}</strong>
          <p>
            基于保量 CPM {settings.guaranteeCpm} / 默认客户 CPM{" "}
            {settings.clientCpm}
          </p>
        </div>
      </section>

      <section className="source-banner" aria-label="飞书数据来源">
        <div className="source-icon">飞</div>
        <div className="source-copy">
          <div className="project-switcher">
            <label htmlFor="project-select">飞书项目</label>
            <select
              id="project-select"
              value={project.name}
              onChange={(event) => switchProject(event.target.value)}
              disabled={syncing}
            >
              {!projects.some((item) => item.name === project.name) && (
                <option value={project.name}>{project.name}</option>
              )}
              {projects.map((item) => (
                <option key={item.recordId} value={item.name}>
                  {item.name}
                  {item.clientName ? ` · ${item.clientName}` : ""}
                </option>
              ))}
            </select>
            <span className="source-badge">已同步</span>
          </div>
          <p>
            {project.clientName} · 项目编号 {project.code} ·{" "}
            {creators.length} 位达人
            {project.taxBasis ? ` · ${project.taxBasis}` : ""}
          </p>
          <small>
            最近同步 {formatSyncTime(project.syncedAt)}；只有点击“写回飞书”并完成
            项目 ID 确认后，才会修改云端数据。
          </small>
          {syncMessage && (
            <small
              className={
                syncMessage.startsWith("同步失败")
                  ? "sync-message error"
                  : "sync-message"
              }
              role="status"
            >
              {syncMessage}
            </small>
          )}
        </div>
        <div className="source-actions">
          <span
            className={
              duplicateDouyinIds.size > 0
                ? "source-quality warning"
                : "source-quality"
            }
          >
            {duplicateDouyinIds.size > 0
              ? `${duplicateDouyinIds.size} 个重复抖音号待核对`
              : "抖音号唯一性正常"}
          </span>
          {project.hiddenCreatorCount > 0 && (
            <span className="source-quality muted">
              已隐藏 {project.hiddenCreatorCount} 位未参与达人
            </span>
          )}
          {writebackPlan.totalWritebackActions > 0 && (
            <span className="source-quality warning">
              {writebackPlan.totalFieldChanges > 0
                ? `${writebackPlan.totalFieldChanges} 项字段变更`
                : ""}
              {writebackPlan.totalFieldChanges > 0 &&
              writebackPlan.creatorCreates.length > 0
                ? " · "
                : ""}
              {writebackPlan.creatorCreates.length > 0
                ? `${writebackPlan.creatorCreates.length} 位达人待新增`
                : ""}
            </span>
          )}
          {writebackPlan.invalidCreatorCreates.length > 0 && (
            <span className="source-quality warning">
              {writebackPlan.invalidCreatorCreates.length} 位新增达人需补全
            </span>
          )}
          <button
            className="sync-button"
            onClick={syncFromFeishu}
            disabled={syncing}
          >
            {syncing ? "同步中…" : "从飞书重新同步"}
          </button>
          <button
            className="writeback-button"
            onClick={openWritebackReview}
            disabled={writingBack || writebackPlan.reviewItemCount === 0}
          >
            写回飞书
            {writebackPlan.reviewItemCount > 0
              ? `（${writebackPlan.reviewItemCount}）`
              : ""}
          </button>
          {project.sourceUrl ? (
            <a
              href={project.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              打开多维表格 ↗
            </a>
          ) : (
            <span className="source-link-disabled" title="同步服务未配置多维表格地址">
              打开多维表格
            </span>
          )}
        </div>
      </section>

      <section className="settings-panel">
        <button
          className="settings-title"
          onClick={() => setShowSettings((value) => !value)}
          aria-expanded={showSettings}
        >
          <span>
            <i className="tune-icon">≡</i>
            全局计算参数
          </span>
          <small>{showSettings ? "收起" : "展开"}⌄</small>
        </button>
        {showSettings && (
          <div className="settings-grid">
            <label>
              <span>保量成本 CPM</span>
              <div className="input-with-unit">
                <b>¥</b>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={settings.guaranteeCpm}
                  onFocus={selectZeroOnFocus}
                  onClick={selectZeroOnFocus}
                  onChange={(event) =>
                    updateSetting(
                      "guaranteeCpm",
                      numberFromInput(event),
                    )
                  }
                />
                <small>/千次</small>
              </div>
            </label>
            <label>
              <span>默认客户 CPM</span>
              <div className="input-with-unit">
                <b>¥</b>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={settings.clientCpm}
                  onFocus={selectZeroOnFocus}
                  onClick={selectZeroOnFocus}
                  onChange={(event) =>
                    updateSetting("clientCpm", numberFromInput(event))
                  }
                />
                <small>/千次</small>
              </div>
            </label>
            <label>
              <span>默认目标毛利率</span>
              <div className="input-with-unit">
                <input
                  type="number"
                  min="0"
                  max="99"
                  step="1"
                  value={settings.defaultMargin}
                  onFocus={selectZeroOnFocus}
                  onClick={selectZeroOnFocus}
                  onChange={(event) =>
                    updateSetting(
                      "defaultMargin",
                      Math.min(numberFromInput(event), 99),
                    )
                  }
                />
                <small>%</small>
              </div>
            </label>
            <label>
              <span>报价取整方式</span>
              <select
                value={settings.rounding}
                onChange={(event) =>
                  updateSetting(
                    "rounding",
                    event.target.value as RoundingMode,
                  )
                }
              >
                <option value="none">向上取整到元</option>
                <option value="hundred">向上取整到百元</option>
                <option value="thousand">向上取整到千元</option>
              </select>
            </label>
            {settings.defaultMargin > theoreticalMaxMargin + 0.01 && (
              <p className="settings-feasibility-warning" role="status">
                当前目标毛利率 {formatPercent(settings.defaultMargin)}
                高于理论最高毛利率 {formatPercent(theoreticalMaxMargin)}。
                自动报价将显示最低不亏价，无法保证目标毛利。
              </p>
            )}
          </div>
        )}
      </section>

      <section className="metrics-grid" aria-label="整包汇总">
        <MetricCard
          label="KPI 总播放量"
          value={formatNumber(summary.totalKpi)}
          hint={`${results.length} 位达人 · ${summary.healthyCount} 位满足目标`}
        />
        <MetricCard
          label="整包总成本"
          value={formatMoney(summary.totalCost)}
          hint={`采买 ${formatMoney(summary.totalPurchase)} · 保量 ${formatMoney(summary.totalGuarantee)}`}
        />
        <MetricCard
          label="当前报价合计"
          value={formatMoney(summary.totalRevenue)}
          hint={`整体客户 CPM ${summary.overallCpm.toFixed(1)}`}
          tone="accent"
        />
        <MetricCard
          label="预计毛利"
          value={formatMoney(summary.totalProfit)}
          hint={`整体毛利率 ${formatPercent(summary.overallMargin)}`}
          tone={summary.totalProfit >= 0 ? "positive" : "default"}
        />
      </section>

      <section className="workspace">
        <div className="section-heading">
          <div>
            <p className="eyebrow">CREATOR BREAKDOWN</p>
            <h2>达人明细</h2>
            <span>可横向滚动查看全部计算结果，修改后会立即重算。</span>
          </div>
          <div className="section-heading-actions">
            <button
              className="button mobile-batch-reset"
              onClick={resetAllManualPrices}
              disabled={manualPriceCount === 0}
            >
              批量恢复建议价
              {manualPriceCount > 0 ? `（${manualPriceCount}）` : ""}
            </button>
            <button className="button accent-button" onClick={addCreator}>
              ＋ 添加达人
            </button>
          </div>
        </div>

        <div className="desktop-table-wrap" ref={tableWrapRef}>
          <table>
            <thead>
              <tr>
                <th className="sticky-col">达人 / 状态</th>
                <th>抖音号</th>
                <th>采买成本</th>
                <th className="price-column-header">
                  <span>当前报价</span>
                  <button
                    className="batch-reset-price"
                    onClick={resetAllManualPrices}
                    disabled={manualPriceCount === 0}
                    title="按最新全局参数重新计算所有手动报价"
                  >
                    批量恢复建议价
                    {manualPriceCount > 0 ? `（${manualPriceCount}）` : ""}
                  </button>
                </th>
                <th>客户CPM</th>
                <th>KPI播放量（自动）</th>
                <th>自然播放</th>
                <th>其他成本</th>
                <th>目标毛利</th>
                <th>保量成本</th>
                <th>总成本</th>
                <th>目标卖价</th>
                <th>实际毛利率</th>
                <th>采买上限</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {results.map((item) => (
                <tr key={item.id}>
                  <td className="sticky-col creator-cell">
                    <input
                      className="name-input"
                      aria-label="达人名称"
                      data-creator-name-id={item.id}
                      value={item.name}
                      placeholder="填写达人名称"
                      onChange={(event) =>
                        updateCreator(item.id, "name", event.target.value)
                      }
                    />
                    <div className="creator-flags">
                      {!item.sourceRecordId && (
                        <span className="pending-sync-pill">待写入飞书</span>
                      )}
                      <StatusPill status={item.status} />
                    </div>
                  </td>
                  <td className="douyin-cell">
                    <input
                      className="douyin-input"
                      aria-label={`${item.name}抖音号`}
                      value={item.douyinId}
                      placeholder="填写抖音号"
                      onChange={(event) =>
                        updateCreator(item.id, "douyinId", event.target.value)
                      }
                    />
                    {duplicateDouyinIds.has(
                      normalizeDouyinId(item.douyinId),
                    ) && (
                      <span className="duplicate-id-warning">抖音号重复</span>
                    )}
                  </td>
                  <td>
                    <MoneyInput
                      label={`${item.name}采买成本`}
                      value={item.purchaseCost}
                      onChange={(value) =>
                        updateCreator(item.id, "purchaseCost", value)
                      }
                    />
                  </td>
                  <td>
                    <div className="price-editor">
                      <MoneyInput
                        label={`${item.name}当前报价`}
                        value={
                          item.manualPrice === null
                            ? item.suggestedPrice
                            : item.manualPrice
                        }
                        onChange={(value) =>
                          updateCreator(item.id, "manualPrice", value)
                        }
                        emphasis
                      />
                      {item.manualPrice !== null && (
                        <button
                          onClick={() =>
                            updateCreator(item.id, "manualPrice", null)
                          }
                        >
                          恢复建议价
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    <CpmInput
                      label={`${item.name}客户CPM`}
                      value={item.customerCpm}
                      onChange={(value) =>
                        updateCreator(item.id, "customerCpm", value)
                      }
                    />
                  </td>
                  <td className="calculated kpi-calculated">
                    <strong>{formatNumber(item.kpiViews)}</strong>
                    <small>报价 ÷ CPM × 1000</small>
                  </td>
                  <td>
                    <NumberInput
                      label={`${item.name}预计自然播放`}
                      value={item.organicViews}
                      onChange={(value) =>
                        updateCreator(item.id, "organicViews", value)
                      }
                    />
                  </td>
                  <td>
                    <MoneyInput
                      label={`${item.name}其他成本`}
                      value={item.otherCost}
                      onChange={(value) =>
                        updateCreator(item.id, "otherCost", value)
                      }
                    />
                  </td>
                  <td>
                    <div className="compact-input suffix">
                      <input
                        aria-label={`${item.name}目标毛利率`}
                        type="number"
                        min="0"
                        max="99"
                        value={item.margin}
                        onFocus={selectZeroOnFocus}
                        onClick={selectZeroOnFocus}
                        onChange={(event) =>
                          updateCreator(
                            item.id,
                            "margin",
                            Math.min(numberFromInput(event), 99),
                          )
                        }
                      />
                      <span>%</span>
                    </div>
                  </td>
                  <td className="calculated">
                    <strong>{formatMoney(item.guaranteeCost)}</strong>
                    <small>保量 {formatNumber(item.requiredViews)}</small>
                  </td>
                  <td className="calculated">
                    <strong>{formatMoney(item.totalCost)}</strong>
                  </td>
                  <td className="calculated target-cell">
                    <strong>
                      {formatMoney(
                        item.pricingMode === "target"
                          ? item.targetPrice
                          : item.suggestedPrice,
                      )}
                    </strong>
                    <small>
                      {item.pricingMode === "target"
                        ? "达到目标毛利的最低价"
                        : item.pricingMode === "break-even"
                          ? "目标不可达，当前为最低不亏价"
                          : "客户CPM无法覆盖保量成本"}
                    </small>
                  </td>
                  <td
                    className={`calculated ${item.actualMargin < item.margin ? "negative-text" : "positive-text"}`}
                  >
                    <strong>{formatPercent(item.actualMargin)}</strong>
                    <small>{formatMoney(item.actualProfit)} 毛利</small>
                  </td>
                  <td className="calculated">
                    <strong>{formatMoney(item.maxPurchaseCost)}</strong>
                    {item.reductionNeeded > 0 && (
                      <small className="negative-text">
                        需降 {formatMoney(item.reductionNeeded)}
                      </small>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        aria-label={`复制${item.name}`}
                        title="复制达人"
                        onClick={() => duplicateCreator(item)}
                      >
                        ⧉
                      </button>
                      <button
                        aria-label={`删除${item.name}`}
                        title="删除达人"
                        onClick={() => removeCreator(item.id)}
                      >
                        ×
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mobile-cards">
          {results.map((item) => (
            <article className="creator-card" key={item.id}>
              <div className="creator-card-title">
                <div className="mobile-creator-identity">
                  <input
                    className="name-input"
                    aria-label="达人名称"
                    data-creator-name-id={item.id}
                    value={item.name}
                    placeholder="填写达人名称"
                    onChange={(event) =>
                      updateCreator(item.id, "name", event.target.value)
                    }
                  />
                  <input
                    className="douyin-input"
                    aria-label={`${item.name}抖音号`}
                    value={item.douyinId}
                    placeholder="填写抖音号"
                    onChange={(event) =>
                      updateCreator(item.id, "douyinId", event.target.value)
                    }
                  />
                  {duplicateDouyinIds.has(
                    normalizeDouyinId(item.douyinId),
                  ) && (
                    <span className="duplicate-id-warning">抖音号重复</span>
                  )}
                </div>
                <div className="creator-flags">
                  {!item.sourceRecordId && (
                    <span className="pending-sync-pill">待写入飞书</span>
                  )}
                  <StatusPill status={item.status} />
                </div>
              </div>
              <div className="mobile-input-grid">
                <MobileField label="采买成本">
                  <MoneyInput
                    label={`${item.name}采买成本`}
                    value={item.purchaseCost}
                    onChange={(value) =>
                      updateCreator(item.id, "purchaseCost", value)
                    }
                  />
                </MobileField>
                <MobileField label="当前报价">
                  <MoneyInput
                    label={`${item.name}当前报价`}
                    value={
                      item.manualPrice === null
                        ? item.suggestedPrice
                        : item.manualPrice
                    }
                    onChange={(value) =>
                      updateCreator(item.id, "manualPrice", value)
                    }
                    emphasis
                  />
                </MobileField>
                <MobileField label="客户 CPM">
                  <CpmInput
                    label={`${item.name}客户CPM`}
                    value={item.customerCpm}
                    onChange={(value) =>
                      updateCreator(item.id, "customerCpm", value)
                    }
                  />
                </MobileField>
                <MobileField label="自然播放量">
                  <NumberInput
                    label={`${item.name}自然播放量`}
                    value={item.organicViews}
                    onChange={(value) =>
                      updateCreator(item.id, "organicViews", value)
                    }
                  />
                </MobileField>
                <MobileField label="目标毛利率">
                  <div className="compact-input suffix">
                    <input
                      aria-label={`${item.name}目标毛利率`}
                      type="number"
                      value={item.margin}
                      onFocus={selectZeroOnFocus}
                      onClick={selectZeroOnFocus}
                      onChange={(event) =>
                        updateCreator(
                          item.id,
                          "margin",
                          Math.min(numberFromInput(event), 99),
                        )
                      }
                    />
                    <span>%</span>
                  </div>
                </MobileField>
              </div>
              <div className="mobile-results">
                <div>
                  <span>总成本</span>
                  <strong>{formatMoney(item.totalCost)}</strong>
                </div>
                <div>
                  <span>KPI 播放量（自动）</span>
                  <strong>{formatNumber(item.kpiViews)}</strong>
                </div>
                <div className="featured-result">
                  <span>当前报价</span>
                  <strong>{formatMoney(item.activePrice)}</strong>
                </div>
                <div>
                  <span>实际毛利率</span>
                  <strong>{formatPercent(item.actualMargin)}</strong>
                </div>
              </div>
              {item.status !== "healthy" && (
                <p className={`mobile-alert ${item.status}`}>
                  {item.pricingMode === "break-even"
                    ? "目标毛利超过当前 CPM 可达到的上限；已采用最低不亏价，请提高客户 CPM 或降低目标毛利率"
                    : item.status === "danger"
                      ? Number.isFinite(item.targetPrice)
                        ? `当前报价预计亏损 ${formatMoney(Math.max(0, -item.actualProfit))}`
                        : "当前客户 CPM 无法覆盖保量成本和目标毛利，请提高 CPM 或降低目标毛利率"
                      : `要达到目标毛利，采买成本需再降低 ${formatMoney(item.reductionNeeded)}`}
                </p>
              )}
              <div className="mobile-card-actions">
                <button onClick={() => duplicateCreator(item)}>复制</button>
                <button onClick={() => removeCreator(item.id)}>删除</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="logic-note">
        <div>
          <span className="note-mark">i</span>
          <div>
            <strong>报价判断口径</strong>
            <p>
              KPI播放量＝当前报价÷客户CPM×1000；保量成本按自动反推的KPI计算。
              绿色表示当前报价已满足目标毛利率。
            </p>
          </div>
        </div>
        <div className="legend">
          <span>
            <i className="legend-dot healthy" />
            满足目标
          </span>
          <span>
            <i className="legend-dot warning" />
            不亏但毛利不足
          </span>
          <span>
            <i className="legend-dot danger" />
            当前报价亏损
          </span>
        </div>
      </section>

      {showWriteback && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !writingBack) {
              setShowWriteback(false);
            }
          }}
        >
          <section
            className="writeback-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="writeback-title"
          >
            <div className="writeback-header">
              <div>
                <p className="eyebrow">FEISHU WRITEBACK REVIEW</p>
                <h2 id="writeback-title">确认写回飞书</h2>
                <span>
                  项目：{project.name} · 项目 ID：{project.code}
                </span>
              </div>
              <button
                aria-label="关闭写回确认"
                onClick={() => setShowWriteback(false)}
                disabled={writingBack}
              >
                ×
              </button>
            </div>

            <div className="writeback-safety">
              <strong>写回保护已开启</strong>
              <p>
                提交前会重新读取飞书并逐字段检查冲突、核对抖音号；
                新达人以追加记录方式写入当前项目，不覆盖原有信息。
                本地删除达人不会删除飞书记录。
              </p>
            </div>

            <div className="writeback-summary">
              <div>
                <span>更新字段</span>
                <strong>{writebackPlan.totalFieldChanges}</strong>
              </div>
              <div>
                <span>更新达人</span>
                <strong>{writebackPlan.creatorChanges.length}</strong>
              </div>
              <div>
                <span>新增达人</span>
                <strong>{writebackPlan.creatorCreates.length}</strong>
              </div>
              <div>
                <span>本地删除不处理</span>
                <strong>{writebackPlan.removedCreatorCount}</strong>
              </div>
            </div>

            <div className="change-list">
              {Object.keys(writebackPlan.projectChanges).length > 0 && (
                <div className="change-group">
                  <h3>全局项目参数</h3>
                  {Object.entries(writebackPlan.projectChanges).map(
                    ([field, change]) => (
                      <div className="change-row" key={field}>
                        <span>{projectFieldLabels[field] ?? field}</span>
                        <del>{formatChangeValue(field, change.before)}</del>
                        <i>→</i>
                        <ins>{formatChangeValue(field, change.after)}</ins>
                      </div>
                    ),
                  )}
                </div>
              )}

              {writebackPlan.creatorCreates.map((creatorCreate) => (
                <div className="change-group create-group" key={creatorCreate.localId}>
                  <h3>
                    <span>{creatorCreate.name}</span>
                    <b>新增至 {project.name}</b>
                  </h3>
                  <div className="create-row">
                    <span>所属项目</span>
                    <ins>{project.name}（{project.code}）</ins>
                  </div>
                  {Object.entries(creatorCreate.fields).map(
                    ([field, value]) => (
                      <div className="create-row" key={field}>
                        <span>{creatorFieldLabels[field] ?? field}</span>
                        <ins>{formatChangeValue(field, value)}</ins>
                      </div>
                    ),
                  )}
                  <div className="create-row">
                    <span>是否参与计算</span>
                    <ins>是</ins>
                  </div>
                </div>
              ))}

              {writebackPlan.creatorChanges.map((creatorChange) => (
                <div className="change-group" key={creatorChange.recordId}>
                  <h3>{creatorChange.name}</h3>
                  {Object.entries(creatorChange.fields).map(
                    ([field, change]) => (
                      <div className="change-row" key={field}>
                        <span>{creatorFieldLabels[field] ?? field}</span>
                        <del>{formatChangeValue(field, change.before)}</del>
                        <i>→</i>
                        <ins>{formatChangeValue(field, change.after)}</ins>
                      </div>
                    ),
                  )}
                </div>
              ))}
            </div>

            {writebackPlan.invalidCreatorCreates.length > 0 && (
              <div className="validation-panel">
                <strong>
                  有 {writebackPlan.invalidCreatorCreates.length} 位达人暂时不能新增
                </strong>
                {writebackPlan.invalidCreatorCreates.map((creator) => (
                  <p key={creator.localId}>
                    {creator.name}：{creator.message}
                  </p>
                ))}
              </div>
            )}

            {writebackConflicts.length > 0 && (
              <div className="conflict-panel">
                <strong>发现 {writebackConflicts.length} 项云端冲突</strong>
                {writebackConflicts.map((conflict, index) => (
                  <p key={`${conflict.name}-${conflict.field}-${index}`}>
                    {conflict.name} · {conflict.field}：同步时为“
                    {String(conflict.expected)}”，飞书当前为“
                    {String(conflict.current)}”
                  </p>
                ))}
              </div>
            )}

            <label className="project-id-confirm">
              <span>
                输入项目 ID <b>{project.code}</b> 确认写回
              </span>
              <input
                value={writebackConfirmation}
                onChange={(event) =>
                  setWritebackConfirmation(event.target.value)
                }
                placeholder="请输入项目 ID"
                autoComplete="off"
              />
            </label>

            {writebackError && (
              <p className="writeback-error" role="alert">
                {writebackError}
              </p>
            )}

            <div className="writeback-actions">
              <button
                className="button ghost"
                onClick={() => setShowWriteback(false)}
                disabled={writingBack}
              >
                取消
              </button>
              <button
                className="button danger-button"
                onClick={submitWriteback}
                disabled={
                  writingBack ||
                  writebackConfirmation.trim() !== project.code ||
                  writebackPlan.totalWritebackActions === 0 ||
                  writebackPlan.invalidCreatorCreates.length > 0
                }
              >
                {writingBack ? "正在检查并写回…" : "确认写回飞书"}
              </button>
            </div>
          </section>
        </div>
      )}

      <footer>
        <span>页面默认保存本地草稿；只有完成项目 ID 确认后才会写回飞书。</span>
        <span>达人报价测算器 · 本地版</span>
      </footer>
    </main>
  );
}

function MoneyInput({
  label,
  value,
  onChange,
  emphasis = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  emphasis?: boolean;
}) {
  return (
    <div className={`compact-input prefix ${emphasis ? "emphasis" : ""}`}>
      <span>¥</span>
      <input
        aria-label={label}
        type="number"
        min="0"
        step="100"
        value={Number.isFinite(value) ? value : 0}
        onFocus={selectZeroOnFocus}
        onClick={selectZeroOnFocus}
        onChange={(event) => onChange(numberFromInput(event))}
      />
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="compact-input">
      <input
        aria-label={label}
        type="number"
        min="0"
        step="10000"
        value={Number.isFinite(value) ? value : 0}
        onFocus={selectZeroOnFocus}
        onClick={selectZeroOnFocus}
        onChange={(event) => onChange(numberFromInput(event))}
      />
    </div>
  );
}

function CpmInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="compact-input prefix cpm-input">
      <span>¥</span>
      <input
        aria-label={label}
        type="number"
        min="0.01"
        step="0.1"
        value={Number.isFinite(value) ? value : 0}
        onFocus={selectZeroOnFocus}
        onClick={selectZeroOnFocus}
        onChange={(event) => onChange(numberFromInput(event))}
      />
    </div>
  );
}

function MobileField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mobile-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
