import { ValidationError } from '../errors/index.js';
import { ChartSpec, createChartSpec } from './charts.js';
import { InsightSet } from './insights.js';
import { MetricSet } from './metrics.js';
import {
  assertKnownKeys,
  assertVersionedDocument,
  cloneJson,
  deepFreeze,
  evaluateAnalysisContext,
  filterFindings,
  getSourceDataset,
  isRecord,
  normalizeEmbeddedSet,
  normalizeGroupBy,
  normalizeId,
  normalizeLimit,
  normalizePrepareOptions,
  normalizeSeverity,
  normalizeSource,
  normalizeText,
  unwrapVersionedDefinition
} from './reporting-utils.js';

const DASHBOARD_VERSION = 1;
const DEFINITION_KEYS = new Set(['title', 'description', 'groupBy', 'metricSet', 'insightSet', 'layout', 'panels']);

/** A serializable layout and analytics composition for renderer-neutral dashboards. */
export class DashboardSpec {
  #definition;
  #metricSet;
  #insightSet;

  constructor(definitionOrDocument) {
    const definition = unwrapVersionedDefinition(definitionOrDocument, 'dashboard', 'DashboardSpec', DASHBOARD_VERSION);
    const normalized = normalizeDashboardDefinition(definition);
    this.#definition = deepFreeze(normalized.definition);
    this.#metricSet = normalized.metricSet;
    this.#insightSet = normalized.insightSet;
    Object.freeze(this);
  }

  static fromJSON(document) {
    assertVersionedDocument(document, 'dashboard', 'DashboardSpec', DASHBOARD_VERSION);
    return new DashboardSpec(document);
  }

  get definition() { return cloneJson(this.#definition); }
  get panels() { return cloneJson(this.#definition.panels); }
  toJSON() { return { version: DASHBOARD_VERSION, dashboard: this.definition }; }

  prepare(dataset, options = {}) {
    const evaluation = normalizePrepareOptions(dataset, this.#definition, options, 'DashboardSpec');
    const panels = this.#definition.panels;
    const needsFindings = panels.some(panel => panel.type === 'insights' || (panel.type === 'chart' && panel.source === 'insights'));
    const needsScorecard = panels.some(panel => panel.type === 'metric' || (panel.type === 'chart' && panel.source === 'metrics'));
    const context = evaluateAnalysisContext({
      dataset,
      metricSet: this.#metricSet,
      insightSet: this.#insightSet,
      baseline: evaluation.baseline,
      groupBy: evaluation.groupBy,
      needScorecard: needsScorecard,
      needFindings: needsFindings
    });

    const preparedPanels = panels.map(panel => {
      const base = { id: panel.id, type: panel.type, layout: cloneJson(panel.layout) };
      if (panel.type === 'metric') {
        return { ...base, metricId: panel.metricId, data: context.scorecard.filter(row => row.metricId === panel.metricId) };
      }
      if (panel.type === 'insights') {
        return {
          ...base,
          severity: panel.severity,
          limit: panel.limit,
          data: filterFindings(context.findings, panel.severity, panel.limit)
        };
      }
      const source = getSourceDataset(panel.source, dataset, context, `Dashboard chart panel "${panel.id}"`);
      return {
        ...base,
        source: panel.source,
        chart: cloneJson(panel.chart),
        data: createChartSpec(panel.chart).prepare(source)
      };
    });

    return {
      version: DASHBOARD_VERSION,
      kind: 'dashboardData',
      title: this.#definition.title,
      description: this.#definition.description,
      groupBy: [...evaluation.groupBy],
      layout: cloneJson(this.#definition.layout),
      panels: preparedPanels
    };
  }
}

export function createDashboardSpec(definitionOrDocument) {
  return new DashboardSpec(definitionOrDocument);
}

function normalizeDashboardDefinition(definition) {
  if (!isRecord(definition)) throw new ValidationError('DashboardSpec dashboard definition must be an object.');
  assertKnownKeys(definition, DEFINITION_KEYS, 'DashboardSpec definition');
  const title = normalizeText(definition.title, 'DashboardSpec title');
  const description = normalizeText(definition.description, 'DashboardSpec description', { optional: true });
  const groupBy = normalizeGroupBy(definition.groupBy, 'DashboardSpec groupBy');
  const metric = normalizeEmbeddedSet(definition.metricSet, MetricSet, 'DashboardSpec metricSet');
  const insight = normalizeEmbeddedSet(definition.insightSet, InsightSet, 'DashboardSpec insightSet');
  const layout = normalizeLayout(definition.layout);
  if (!Array.isArray(definition.panels) || definition.panels.length === 0) {
    throw new ValidationError('DashboardSpec requires a non-empty panels array.');
  }
  const panels = definition.panels.map((panel, index) => normalizePanel(panel, index, layout.columns));
  const ids = panels.map(panel => panel.id);
  if (new Set(ids).size !== ids.length) throw new ValidationError('Dashboard panel IDs must be unique.');
  validatePanelDependencies(panels, metric.instance, insight.instance);
  validatePanelOverlap(panels);
  return {
    metricSet: metric.instance,
    insightSet: insight.instance,
    definition: {
      title,
      description,
      groupBy,
      metricSet: metric.document,
      insightSet: insight.document,
      layout,
      panels
    }
  };
}

function normalizeLayout(value) {
  if (value === undefined || value === null) value = {};
  if (!isRecord(value)) throw new ValidationError('DashboardSpec layout must be an object.');
  assertKnownKeys(value, new Set(['columns']), 'DashboardSpec layout');
  const columns = value.columns ?? 12;
  if (!Number.isInteger(columns) || columns < 1) throw new ValidationError('DashboardSpec layout columns must be a positive integer.');
  return { columns };
}

function normalizePanel(panel, index, columns) {
  if (!isRecord(panel)) throw new ValidationError(`Dashboard panel ${index + 1} must be an object.`);
  const id = normalizeId(panel.id, `Dashboard panel ${index + 1} id`);
  const type = panel.type;
  if (!['metric', 'chart', 'insights'].includes(type)) {
    throw new ValidationError(`Dashboard panel "${id}" type must be metric, chart, or insights.`);
  }
  const layout = normalizePanelLayout(panel.layout, id, columns);
  if (type === 'metric') {
    assertKnownKeys(panel, new Set(['id', 'type', 'metricId', 'layout']), `Dashboard metric panel "${id}"`);
    return { id, type, metricId: normalizeId(panel.metricId, `Dashboard metric panel "${id}" metricId`), layout };
  }
  if (type === 'insights') {
    assertKnownKeys(panel, new Set(['id', 'type', 'severity', 'limit', 'layout']), `Dashboard insights panel "${id}"`);
    return {
      id,
      type,
      severity: normalizeSeverity(panel.severity, `Dashboard insights panel "${id}" severity`),
      limit: normalizeLimit(panel.limit, `Dashboard insights panel "${id}" limit`),
      layout
    };
  }
  assertKnownKeys(panel, new Set(['id', 'type', 'source', 'chart', 'layout']), `Dashboard chart panel "${id}"`);
  if (panel.chart === undefined || panel.chart === null) throw new ValidationError(`Dashboard chart panel "${id}" requires a chart definition.`);
  const chart = panel.chart instanceof ChartSpec ? panel.chart : createChartSpec(panel.chart);
  return { id, type, source: normalizeSource(panel.source, `Dashboard chart panel "${id}" source`), chart: chart.toJSON(), layout };
}

function normalizePanelLayout(value, id, columns) {
  if (!isRecord(value)) throw new ValidationError(`Dashboard panel "${id}" requires a layout object.`);
  assertKnownKeys(value, new Set(['x', 'y', 'w', 'h']), `Dashboard panel "${id}" layout`);
  const { x, y, w, h } = value;
  if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1) {
    throw new ValidationError(`Dashboard panel "${id}" layout requires non-negative integer x/y and positive integer w/h.`);
  }
  if (x + w > columns) throw new ValidationError(`Dashboard panel "${id}" exceeds the ${columns}-column layout.`);
  return { x, y, w, h };
}

function validatePanelDependencies(panels, metricSet, insightSet) {
  const metricIds = new Set(metricSet?.metrics.map(metric => metric.id) ?? []);
  const hasInsightMetricRules = insightSet?.rules.some(rule => rule.type !== 'outlier') ?? false;
  if (hasInsightMetricRules && !metricSet) throw new ValidationError('Dashboard metric insight rules require a MetricSet.');
  for (const panel of panels) {
    if (panel.type === 'metric') {
      if (!metricSet) throw new ValidationError(`Dashboard metric panel "${panel.id}" requires a MetricSet.`);
      if (!metricIds.has(panel.metricId)) throw new ValidationError(`Dashboard panel "${panel.id}" references unknown metric: ${panel.metricId}`);
    }
    if (panel.type === 'insights' && !insightSet) throw new ValidationError(`Dashboard insights panel "${panel.id}" requires an InsightSet.`);
    if (panel.type === 'chart' && panel.source === 'metrics' && !metricSet) throw new ValidationError(`Dashboard chart panel "${panel.id}" requires a MetricSet source.`);
    if (panel.type === 'chart' && panel.source === 'insights' && !insightSet) throw new ValidationError(`Dashboard chart panel "${panel.id}" requires an InsightSet source.`);
  }
}

function validatePanelOverlap(panels) {
  for (let left = 0; left < panels.length; left += 1) {
    for (let right = left + 1; right < panels.length; right += 1) {
      const a = panels[left].layout;
      const b = panels[right].layout;
      const overlaps = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      if (overlaps) throw new ValidationError(`Dashboard panels "${panels[left].id}" and "${panels[right].id}" overlap.`);
    }
  }
}
