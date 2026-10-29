import { describe, it, expect, beforeEach } from '@jest/globals';
import { MetricsRegistry } from '@eventforge/common';

describe('Prometheus Metrics Registry', () => {
  let registry: MetricsRegistry;

  beforeEach(() => {
    registry = new MetricsRegistry();
  });

  describe('Counter', () => {
    it('should increment by 1 by default', () => {
      const counter = registry.registerCounter('test_counter_total', 'A test counter');
      counter.inc();
      expect(counter.get()).toBe(1);
      counter.inc();
      expect(counter.get()).toBe(2);
    });

    it('should increment by custom amount and handle bounded labels', () => {
      const counter = registry.registerCounter(
        'test_labeled_counter_total',
        'A test labeled counter',
        ['status'],
      );
      counter.inc({ status: '200' }, 5);
      counter.inc({ status: '400' }, 2);

      expect(counter.get({ status: '200' })).toBe(5);
      expect(counter.get({ status: '400' })).toBe(2);
      expect(counter.get({ status: '500' })).toBe(0);
    });

    it('should reject negative increments', () => {
      const counter = registry.registerCounter('test_neg_counter', 'Help');
      expect(() => counter.inc(-1)).toThrow();
    });

    it('should format counter in Prometheus exposition format', () => {
      const counter = registry.registerCounter('http_requests_total', 'Total HTTP requests', [
        'method',
      ]);
      counter.inc({ method: 'POST' }, 3);

      const formatted = counter.format();
      expect(formatted).toContain('# HELP http_requests_total Total HTTP requests');
      expect(formatted).toContain('# TYPE http_requests_total counter');
      expect(formatted).toContain('http_requests_total{method="POST"} 3');
    });
  });

  describe('Gauge', () => {
    it('should set, increment, and decrement values', () => {
      const gauge = registry.registerGauge('test_gauge', 'A test gauge');
      gauge.set(42);
      expect(gauge.get()).toBe(42);

      gauge.inc(8);
      expect(gauge.get()).toBe(50);

      gauge.dec(20);
      expect(gauge.get()).toBe(30);
    });

    it('should collect dynamic values on format', async () => {
      const gauge = registry.registerGauge('dynamic_gauge', 'A dynamic gauge');
      let simulatedDbCount = 17;
      gauge.setCollector(() => Promise.resolve(simulatedDbCount));

      const formatted = await gauge.format();
      expect(formatted).toContain('dynamic_gauge 17');

      simulatedDbCount = 25;
      const formatted2 = await gauge.format();
      expect(formatted2).toContain('dynamic_gauge 25');
    });
  });

  describe('Histogram', () => {
    it('should observe values and calculate bucket distributions', () => {
      const histogram = registry.registerHistogram(
        'request_duration_seconds',
        'Request duration',
        [0.1, 0.5, 1.0],
      );

      histogram.observe(0.05);
      histogram.observe(0.2);
      histogram.observe(0.8);
      histogram.observe(2.5);

      const formatted = histogram.format();
      expect(formatted).toContain('# TYPE request_duration_seconds histogram');
      expect(formatted).toContain('request_duration_seconds_bucket{le="0.1"} 1');
      expect(formatted).toContain('request_duration_seconds_bucket{le="0.5"} 2');
      expect(formatted).toContain('request_duration_seconds_bucket{le="1"} 3');
      expect(formatted).toContain('request_duration_seconds_bucket{le="+Inf"} 4');
      expect(formatted).toContain('request_duration_seconds_count 4');
      expect(formatted).toContain('request_duration_seconds_sum 3.55');
    });
  });

  describe('Full Prometheus Export', () => {
    it('should export all registered metrics', async () => {
      registry.registerCounter('events_total', 'Events count').inc(10);
      registry.registerGauge('in_flight', 'Current in flight').set(3);

      const exported = await registry.exportPrometheusText();
      expect(exported).toContain('# TYPE events_total counter');
      expect(exported).toContain('events_total 10');
      expect(exported).toContain('# TYPE in_flight gauge');
      expect(exported).toContain('in_flight 3');
    });
  });
});
