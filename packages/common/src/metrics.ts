/**
 * Lightweight, zero-dependency Prometheus-compatible metrics instrumentation.
 * Complies with Prometheus text exposition format (version 0.0.4).
 */

export type MetricType = 'counter' | 'gauge' | 'histogram';

export type MetricLabels = Record<string, string | number | boolean>;

function serializeLabels(labels?: MetricLabels): string {
  if (!labels) return '';
  const entries = Object.entries(labels).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return '';

  // Sort keys for deterministic label order
  entries.sort(([a], [b]) => a.localeCompare(b));

  const serialized = entries
    .map(([k, v]) => {
      const escaped = String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
      return `${k}="${escaped}"`;
    })
    .join(',');

  return `{${serialized}}`;
}

function normalizeLabels(labels?: MetricLabels): string {
  if (!labels) return '';
  const entries = Object.entries(labels).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return '';
  entries.sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

export class Counter {
  private values = new Map<string, { value: number; labels?: MetricLabels | undefined }>();

  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly labelNames: string[] = [],
  ) {}

  inc(labelsOrBy?: MetricLabels | number, by = 1): void {
    let labels: MetricLabels | undefined;
    let increment = by;

    if (typeof labelsOrBy === 'number') {
      increment = labelsOrBy;
    } else if (typeof labelsOrBy === 'object' && labelsOrBy !== null) {
      labels = labelsOrBy;
    }

    if (increment < 0) {
      throw new Error(
        `Counter ${this.name} cannot be incremented by a negative value: ${increment}`,
      );
    }

    const key = normalizeLabels(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += increment;
    } else {
      this.values.set(key, { value: increment, labels });
    }
  }

  get(labels?: MetricLabels): number {
    const key = normalizeLabels(labels);
    return this.values.get(key)?.value ?? 0;
  }

  reset(): void {
    this.values.clear();
  }

  format(): string {
    const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];

    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
      return lines.join('\n');
    }

    for (const entry of this.values.values()) {
      lines.push(`${this.name}${serializeLabels(entry.labels)} ${entry.value}`);
    }

    return lines.join('\n');
  }
}

export type DynamicGaugeCollector = () =>
  | Promise<number | Array<{ value: number; labels?: MetricLabels }>>
  | number
  | Array<{ value: number; labels?: MetricLabels }>;

export class Gauge {
  private values = new Map<string, { value: number; labels?: MetricLabels | undefined }>();
  private collector: DynamicGaugeCollector | null = null;

  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly labelNames: string[] = [],
  ) {}

  set(value: number, labels?: MetricLabels): void {
    const key = normalizeLabels(labels);
    this.values.set(key, { value, labels });
  }

  inc(labelsOrBy?: MetricLabels | number, by = 1): void {
    let labels: MetricLabels | undefined;
    let increment = by;

    if (typeof labelsOrBy === 'number') {
      increment = labelsOrBy;
    } else if (typeof labelsOrBy === 'object' && labelsOrBy !== null) {
      labels = labelsOrBy;
    }

    const key = normalizeLabels(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += increment;
    } else {
      this.values.set(key, { value: increment, labels });
    }
  }

  dec(labelsOrBy?: MetricLabels | number, by = 1): void {
    let labels: MetricLabels | undefined;
    let decrement = by;

    if (typeof labelsOrBy === 'number') {
      decrement = labelsOrBy;
    } else if (typeof labelsOrBy === 'object' && labelsOrBy !== null) {
      labels = labelsOrBy;
    }

    const key = normalizeLabels(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value -= decrement;
    } else {
      this.values.set(key, { value: -decrement, labels });
    }
  }

  setCollector(collector: DynamicGaugeCollector): void {
    this.collector = collector;
  }

  get(labels?: MetricLabels): number {
    const key = normalizeLabels(labels);
    return this.values.get(key)?.value ?? 0;
  }

  reset(): void {
    this.values.clear();
  }

  async collect(): Promise<void> {
    if (!this.collector) return;

    try {
      const result = await this.collector();
      if (typeof result === 'number') {
        this.set(result);
      } else if (Array.isArray(result)) {
        for (const item of result) {
          this.set(item.value, item.labels);
        }
      }
    } catch {
      // In case of dynamic collection failure, retain last known state
    }
  }

  async format(): Promise<string> {
    await this.collect();

    const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];

    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
      return lines.join('\n');
    }

    for (const entry of this.values.values()) {
      lines.push(`${this.name}${serializeLabels(entry.labels)} ${entry.value}`);
    }

    return lines.join('\n');
  }
}

export const DEFAULT_HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface HistogramBucketData {
  sum: number;
  count: number;
  bucketCounts: Map<number, number>; // bucket threshold -> count
  labels?: MetricLabels | undefined;
}

export class Histogram {
  public readonly buckets: number[];
  private values = new Map<string, HistogramBucketData>();

  constructor(
    public readonly name: string,
    public readonly help: string,
    buckets?: number[],
    public readonly labelNames: string[] = [],
  ) {
    const sorted = [...(buckets ?? DEFAULT_HISTOGRAM_BUCKETS)].sort((a, b) => a - b);
    this.buckets = sorted;
  }

  observe(value: number, labels?: MetricLabels): void {
    const key = normalizeLabels(labels);
    let data = this.values.get(key);

    if (!data) {
      const bucketCounts = new Map<number, number>();
      for (const b of this.buckets) {
        bucketCounts.set(b, 0);
      }
      const newData: HistogramBucketData = { sum: 0, count: 0, bucketCounts, labels };
      this.values.set(key, newData);
      data = newData;
    }

    data.sum += value;
    data.count += 1;

    for (const b of this.buckets) {
      if (value <= b) {
        data.bucketCounts.set(b, (data.bucketCounts.get(b) ?? 0) + 1);
      }
    }
  }

  startTimer(labels?: MetricLabels): () => number {
    const start = process.hrtime.bigint();
    return () => {
      const deltaNs = process.hrtime.bigint() - start;
      const seconds = Number(deltaNs) / 1_000_000_000;
      this.observe(seconds, labels);
      return seconds;
    };
  }

  reset(): void {
    this.values.clear();
  }

  format(): string {
    const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];

    if (this.values.size === 0) {
      for (const b of this.buckets) {
        lines.push(`${this.name}_bucket{le="${b}"} 0`);
      }
      lines.push(`${this.name}_bucket{le="+Inf"} 0`);
      lines.push(`${this.name}_sum 0`);
      lines.push(`${this.name}_count 0`);
      return lines.join('\n');
    }

    for (const data of this.values.values()) {
      const baseLabels = data.labels ?? {};

      for (const b of this.buckets) {
        const bucketLabels = { ...baseLabels, le: String(b) };
        lines.push(
          `${this.name}_bucket${serializeLabels(bucketLabels)} ${data.bucketCounts.get(b) ?? 0}`,
        );
      }

      const infLabels = { ...baseLabels, le: '+Inf' };
      lines.push(`${this.name}_bucket${serializeLabels(infLabels)} ${data.count}`);
      lines.push(`${this.name}_sum${serializeLabels(baseLabels)} ${data.sum}`);
      lines.push(`${this.name}_count${serializeLabels(baseLabels)} ${data.count}`);
    }

    return lines.join('\n');
  }
}

export class MetricsRegistry {
  private counters = new Map<string, Counter>();
  private gauges = new Map<string, Gauge>();
  private histograms = new Map<string, Histogram>();

  registerCounter(name: string, help: string, labelNames: string[] = []): Counter {
    let existing = this.counters.get(name);
    if (!existing) {
      existing = new Counter(name, help, labelNames);
      this.counters.set(name, existing);
    }
    return existing;
  }

  registerGauge(name: string, help: string, labelNames: string[] = []): Gauge {
    let existing = this.gauges.get(name);
    if (!existing) {
      existing = new Gauge(name, help, labelNames);
      this.gauges.set(name, existing);
    }
    return existing;
  }

  registerHistogram(
    name: string,
    help: string,
    buckets?: number[],
    labelNames: string[] = [],
  ): Histogram {
    let existing = this.histograms.get(name);
    if (!existing) {
      existing = new Histogram(name, help, buckets, labelNames);
      this.histograms.set(name, existing);
    }
    return existing;
  }

  getCounter(name: string): Counter | undefined {
    return this.counters.get(name);
  }

  getGauge(name: string): Gauge | undefined {
    return this.gauges.get(name);
  }

  getHistogram(name: string): Histogram | undefined {
    return this.histograms.get(name);
  }

  resetAll(): void {
    for (const c of this.counters.values()) c.reset();
    for (const g of this.gauges.values()) g.reset();
    for (const h of this.histograms.values()) h.reset();
  }

  async exportPrometheusText(): Promise<string> {
    const sections: string[] = [];

    for (const counter of this.counters.values()) {
      sections.push(counter.format());
    }

    for (const gauge of this.gauges.values()) {
      sections.push(await gauge.format());
    }

    for (const histogram of this.histograms.values()) {
      sections.push(histogram.format());
    }

    return sections.length > 0 ? `${sections.join('\n\n')}\n` : '';
  }
}

export const defaultMetricsRegistry = new MetricsRegistry();
