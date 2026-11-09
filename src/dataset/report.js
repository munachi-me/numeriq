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
  normalizeBody,
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

const REPORT_VERSION = 1;
const DEFINITION_KEYS = new Set(['title', 'description', 'groupBy', 'metricSet', 'insightSet', 'sections']);
const REPORT_TABLE_DEFAULT_LIMIT = 100;

/** An ordered, serializable report definition that prepares a JSON-friendly snapshot. */
export class ReportSpec {
  #definition;
  #metricSet;
  #insightSet;

  constructor(definitionOrDocument) {
    const definition = unwrapVersionedDefinition(definitionOrDocument, 'report', 'ReportSpec', REPORT_VERSION);
    const normalized = normalizeReportDefinition(definition);
    this.#definition = deepFreeze(normalized.definition);
    this.#metricSet = normalized.metricSet;
    this.#insightSet = normalized.insightSet;
    Object.freeze(this);
  }

  static fromJSON(document) {
    assertVersionedDocument(document, 'report', 'ReportSpec', REPORT_VERSION);
    return new ReportSpec(document);
  }

  get definition() { return cloneJson(this.#definition); }
  get sections() { return cloneJson(this.#definition.sections); }
  toJSON() { return { version: REPORT_VERSION, report: this.definition }; }

  prepare(dataset, options = {}) {
    const evaluation = normalizePrepareOptions(dataset, this.#definition, options, 'ReportSpec', true);
    const sections = this.#definition.sections;
    const needsFindings = sections.some(section => section.type === 'insights' || (section.type === 'chart' && section.source === 'insights') || (section.type === 'table' && section.source === 'insights'));
    const needsScorecard = sections.some(section => section.type === 'metrics' || (section.type === 'chart' && section.source === 'metrics') || (section.type === 'table' && section.source === 'metrics'));
    const context = evaluateAnalysisContext({
      dataset,
      metricSet: this.#metricSet,
      insightSet: this.#insightSet,
      baseline: evaluation.baseline,
      groupBy: evaluation.groupBy,
      needScorecard: needsScorecard,
      needFindings: needsFindings
    });

    const preparedSections = sections.map(section => {
      if (section.type === 'text') return { id: section.id, type: 'text', heading: section.heading, text: section.text };
      if (section.type === 'metrics') {
        let data = context.scorecard;
        if (section.metricIds !== null) {
          const ids = new Set(section.metricIds);
          data = data.filter(row => ids.has(row.metricId));
        }
        if (section.limit !== null) data = data.head(section.limit);
        return { id: section.id, type: 'metrics', metricIds: section.metricIds, limit: section.limit, data };
      }
      if (section.type === 'insights') {
        return {
          id: section.id,
          type: 'insights',
          severity: section.severity,
          limit: section.limit,
          data: filterFindings(context.findings, section.severity, section.limit)
        };
      }
      const source = getSourceDataset(section.source, dataset, context, `Report section "${section.id}"`);
      if (section.type === 'chart') {
        return {
          id: section.id,
          type: 'chart',
          source: section.source,
          chart: cloneJson(section.chart),
          data: createChartSpec(section.chart).prepare(source)
        };
      }
      let data = section.columns === null ? source : source.select(section.columns);
      if (section.limit !== null) data = data.head(section.limit);
      return {
        id: section.id,
        type: 'table',
        source: section.source,
        columns: section.columns,
        limit: section.limit,
        data
      };
    });

    return {
      version: REPORT_VERSION,
      kind: 'reportSnapshot',
      title: this.#definition.title,
      description: this.#definition.description,
      groupBy: [...evaluation.groupBy],
      ...(evaluation.generatedAt === undefined ? {} : { generatedAt: evaluation.generatedAt }),
      sections: preparedSections
    };
  }
}

export function createReportSpec(definitionOrDocument) {
  return new ReportSpec(definitionOrDocument);
}

function normalizeReportDefinition(definition) {
  if (!isRecord(definition)) throw new ValidationError('ReportSpec report definition must be an object.');
  assertKnownKeys(definition, DEFINITION_KEYS, 'ReportSpec definition');
  const title = normalizeText(definition.title, 'ReportSpec title');
  const description = normalizeText(definition.description, 'ReportSpec description', { optional: true });
  const groupBy = normalizeGroupBy(definition.groupBy, 'ReportSpec groupBy');
  const metric = normalizeEmbeddedSet(definition.metricSet, MetricSet, 'ReportSpec metricSet');
  const insight = normalizeEmbeddedSet(definition.insightSet, InsightSet, 'ReportSpec insightSet');
  if (!Array.isArray(definition.sections) || definition.sections.length === 0) {
    throw new ValidationError('ReportSpec requires a non-empty sections array.');
  }
  const sections = definition.sections.map((section, index) => normalizeSection(section, index));
  const ids = sections.map(section => section.id);
  if (new Set(ids).size !== ids.length) throw new ValidationError('Report section IDs must be unique.');
  validateSectionDependencies(sections, metric.instance, insight.instance);
  return {
    metricSet: metric.instance,
    insightSet: insight.instance,
    definition: {
      title,
      description,
      groupBy,
      metricSet: metric.document,
      insightSet: insight.document,
      sections
    }
  };
}

function normalizeSection(section, index) {
  if (!isRecord(section)) throw new ValidationError(`Report section ${index + 1} must be an object.`);
  const id = normalizeId(section.id, `Report section ${index + 1} id`);
  const type = section.type;
  if (!['text', 'metrics', 'insights', 'chart', 'table'].includes(type)) {
    throw new ValidationError(`Report section "${id}" type must be text, metrics, insights, chart, or table.`);
  }
  if (type === 'text') {
    assertKnownKeys(section, new Set(['id', 'type', 'heading', 'text']), `Report text section "${id}"`);
    return {
      id,
      type,
      heading: normalizeText(section.heading, `Report text section "${id}" heading`, { optional: true }),
      text: normalizeBody(section.text, `Report text section "${id}" text`)
    };
  }
  if (type === 'metrics') {
    assertKnownKeys(section, new Set(['id', 'type', 'metricIds', 'limit']), `Report metrics section "${id}"`);
    const metricIds = section.metricIds === undefined || section.metricIds === null ? null : normalizeIdList(section.metricIds, `Report metrics section "${id}" metricIds`);
    return { id, type, metricIds, limit: normalizeLimit(section.limit, `Report metrics section "${id}" limit`) };
  }
  if (type === 'insights') {
    assertKnownKeys(section, new Set(['id', 'type', 'severity', 'limit']), `Report insights section "${id}"`);
    return {
      id,
      type,
      severity: normalizeSeverity(section.severity, `Report insights section "${id}" severity`),
      limit: normalizeLimit(section.limit, `Report insights section "${id}" limit`)
    };
  }
  if (type === 'chart') {
    assertKnownKeys(section, new Set(['id', 'type', 'source', 'chart']), `Report chart section "${id}"`);
    if (section.chart === undefined || section.chart === null) throw new ValidationError(`Report chart section "${id}" requires a chart definition.`);
    const chart = section.chart instanceof ChartSpec ? section.chart : createChartSpec(section.chart);
    return { id, type, source: normalizeSource(section.source, `Report chart section "${id}" source`), chart: chart.toJSON() };
  }
  assertKnownKeys(section, new Set(['id', 'type', 'source', 'columns', 'limit']), `Report table section "${id}"`);
  let columns = null;
  if (section.columns !== undefined && section.columns !== null) {
    columns = normalizeIdList(section.columns, `Report table section "${id}" columns`);
    if (columns.length === 0) throw new ValidationError(`Report table section "${id}" columns must not be empty.`);
  }
  return {
    id,
    type,
    source: normalizeSource(section.source, `Report table section "${id}" source`),
    columns,
    limit: normalizeLimit(section.limit, `Report table section "${id}" limit`, REPORT_TABLE_DEFAULT_LIMIT)
  };
}

function normalizeIdList(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new ValidationError(`${label} must be an array of non-empty strings.`);
  }
  const normalized = value.map(item => item.trim());
  if (new Set(normalized).size !== normalized.length) throw new ValidationError(`${label} values must be unique.`);
  return normalized;
}

function validateSectionDependencies(sections, metricSet, insightSet) {
  const metricIds = new Set(metricSet?.metrics.map(metric => metric.id) ?? []);
  const hasInsightMetricRules = insightSet?.rules.some(rule => rule.type !== 'outlier') ?? false;
  if (hasInsightMetricRules && !metricSet) throw new ValidationError('Report metric insight rules require a MetricSet.');
  for (const section of sections) {
    if (section.type === 'metrics') {
      if (!metricSet) throw new ValidationError(`Report metrics section "${section.id}" requires a MetricSet.`);
      if (section.metricIds !== null) {
        for (const metricId of section.metricIds) {
          if (!metricIds.has(metricId)) throw new ValidationError(`Report section "${section.id}" references unknown metric: ${metricId}`);
        }
      }
    }
    if (section.type === 'insights' && !insightSet) throw new ValidationError(`Report insights section "${section.id}" requires an InsightSet.`);
    if (section.type === 'chart' && section.source === 'metrics' && !metricSet) throw new ValidationError(`Report chart section "${section.id}" requires a MetricSet source.`);
    if (section.type === 'chart' && section.source === 'insights' && !insightSet) throw new ValidationError(`Report chart section "${section.id}" requires an InsightSet source.`);
    if (section.type === 'table' && section.source === 'metrics' && !metricSet) throw new ValidationError(`Report table section "${section.id}" requires a MetricSet source.`);
    if (section.type === 'table' && section.source === 'insights' && !insightSet) throw new ValidationError(`Report table section "${section.id}" requires an InsightSet source.`);
  }
}
